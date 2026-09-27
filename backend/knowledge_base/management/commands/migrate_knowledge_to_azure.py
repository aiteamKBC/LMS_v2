"""Copy one book to an existing private Azure container; retain local files."""
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.core.management.base import BaseCommand, CommandError

from knowledge_base import storage
from knowledge_base.repository import Repository


class Command(BaseCommand):
    help = "Preview a book's Azure migration; --apply uploads, verifies and updates its storage references."

    def add_arguments(self, parser):
        parser.add_argument("--book-id", type=uuid.UUID, required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        repo, local = Repository(), storage.LocalStorage()
        versions, assets = repo.book_storage_records(options["book_id"])
        if not versions:
            raise CommandError("Book not found.")
        records = [r for r in versions + assets if r["storage_ref"].startswith("local:")]
        paths, expected_hashes = {}, {}
        for record in records:
            key = record["storage_ref"][len(local.prefix):]
            path = local._path(key)
            if not path.is_file():
                raise CommandError("A referenced local book file is missing; migration stopped.")
            with path.open("rb") as stream:
                digest = storage.sha256_of_file(stream)
            if digest != str(record.get("file_sha256") or record["sha256"]).strip():
                raise CommandError("A local book file does not match its registered hash.")
            paths[key] = path
            expected_hashes[key] = digest
        for version in versions:
            folder = local._path(f"previews/{version['id']}")
            for path in sorted(folder.glob("*.webp")):
                key = path.relative_to(local.root.resolve()).as_posix()
                paths[key] = local._path(key)
        total = sum(path.stat().st_size for path in paths.values())
        self.stdout.write(f"Book {options['book_id']}: {len(paths)} local files, {total:,} bytes; {len(records)} database references.")
        if not options["apply"]:
            self.stdout.write("Dry run only. No Azure or database writes. Set KNOWLEDGE_BASE_AZURE_CONTAINER and use --apply to migrate.")
            return
        try:
            remote = storage.AzureStorage()
            remote._check_private()

            def copy_verified(key, path):
                with path.open("rb") as stream:
                    digest = storage.sha256_of_file(stream)
                    if key in expected_hashes and digest != expected_hashes[key]:
                        raise storage.StorageError("A local source changed after the migration inventory.")
                    ref = remote.put_stream(key, stream)
                if storage.sha256_of(remote.get(ref)) != digest:
                    raise storage.StorageError("Azure verification failed; database references were not changed.")

            # Only transfers run concurrently. All reference updates remain one
            # transaction after every upload and downloaded hash has passed.
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(copy_verified, key, path) for key, path in paths.items()]
                for index, future in enumerate(as_completed(futures), 1):
                    future.result()
                    if index % 50 == 0:
                        self.stdout.write(f"Verified {index}/{len(paths)} files.")
            for record in records:
                record["new_ref"] = remote.prefix + record["storage_ref"][len(local.prefix):]
            repo.replace_storage_refs([r for r in versions if "new_ref" in r], [r for r in assets if "new_ref" in r])
        except Exception as exc:
            # Credentials/SDK request URLs must not be echoed in command output.
            raise CommandError(f"Migration stopped ({type(exc).__name__}). Local files were retained; retry after resolving the failure.") from None
        current_versions, current_assets = repo.book_storage_records(options["book_id"])
        if any(r["storage_ref"].startswith("local:") for r in current_versions + current_assets):
            raise CommandError("Some local references remain. Retry to include concurrent uploads.")
        self.stdout.write(self.style.SUCCESS("Book, assets and local previews copied and verified. Local files retained."))
