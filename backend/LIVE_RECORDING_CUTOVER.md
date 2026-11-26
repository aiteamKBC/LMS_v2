# Live recording ownership and historical playback

Materials, manual component uploads and standalone Free Courses retain their
existing `BUNNY_STREAM_LIBRARY_ID` route. Live-session originals use
`BUNNY_LIVE_STREAM_LIBRARY_ID` only after the one-time
`BUNNY_LIVE_RECORDING_UPLOADS_ENABLED=true` cutover. The switch defaults off so
reviewed code can be deployed without enabling another uploader into LiveSessions
while the peer is still uploading there.

Prerequisites: the LiveSessions API key and its own playback token key must be
configured as `BUNNY_LIVE_STREAM_API_KEY` and `BUNNY_LIVE_STREAM_TOKEN_KEY`.
Credentials are selected by the saved library; material credentials are not
reused for a different library. Never commit these values or private manifests.

The LMS is the source of truth. The downstream checker adapts to the LMS
contract; its private ID-generation algorithm is not an application dependency.
Export the authoritative Microsoft recording identities, current component/week
bindings and actual published player references with a SELECT-only command:

```sh
python manage.py export_live_recording_sources --output /private/lms-source-contract.json
```

The `lms.live-recording-sources.v1` file contains no access keys, source URLs,
meeting join links or learner rosters. It explicitly reports whether the live
cutover is active. Give it to the checker owner to reconcile historical data and
make their system consume the LMS identities and current playback, rather than
changing the LMS to imitate their identifiers.

## Before the owner switch

1. Obtain a current inventory and a verified source mapping for historical peer
   uploads. The mapping must tie the exact Microsoft recording ID to the peer's
   `kbc_recording_identity` and the existing Bunny GUID. Include the original
   `source_content_sha256` when available to reconcile Graph aliases. An occurrence, title,
   lecture date, duration or part number alone is insufficient. Multiple parts
   of the same occurrence remain separate originals.
2. Verify protected LiveSessions play-data and the public iframe using the
   library's own token key. The valid signature must work and a deliberately
   invalid signature must be rejected; API credentials are never sent to the
   public player. A publicly accessible or misconfigured library cannot pass.
3. With original uploads still disabled, adopt already-uploaded, source-verified
   videos and confirm the same GUID through the saved LMS component/week binding.
4. Have the other uploader stop starting originals and drain its in-flight
   original-transfer jobs. Keep its checks, clips and reports running. Record
   its acknowledgement before enabling the LMS ownership switch.
5. Enable the switch on the AWS session worker and relevant API tasks, restart
   through the reviewed configuration path, and verify one new original in
   LiveSessions, its module collection and the LMS component. Verify the other
   system checks that same library/GUID and does not create a second original.

## Historical migration (including Fanar)

Use the existing production AWS environment. Do not run the production session
worker on a developer machine. The migration command below plans by default;
its apply mode only queues durable imports. The existing scheduled AWS worker
performs transfers, protected-playback verification and the player projection.

```sh
python manage.py migrate_live_recordings --series-id SAVED_SERIES_ID \
  --mapping-manifest /private/verified-sources.json \
  --plan-output /private/new-reviewed-plan.json
```

Omit the manifest for an original not already present in LiveSessions. The plan
will block if it finds unidentified peer media for the same occurrence. It will
not queue a new original while the ownership switch is off. To apply the exact
reviewed selection, use the same options without `--plan-output`, adding:

```sh
--apply --expected-plan REVIEWED_PLAN_SHA256
```

Private manifest format (synthetic placeholders only):

```json
{
  "version": 1,
  "imports": [{
    "import_id": "00000000-0000-0000-0000-000000000001",
    "graph_artifact_id": "EXACT_MICROSOFT_RECORDING_ID",
    "peer_recording_identity": "VERIFIED_PEER_SOURCE_ID",
    "video_id": "00000000-0000-0000-0000-000000000002"
  }]
}
```

The old journal row, original source and old Bunny GUID remain intact. A separate
idempotent replacement import retains the session, occurrence, component and
week identities. Pending/failed migrations project the historical player.
Only a ready replacement with verified protected playback replaces that player;
later processing of the historical journal cannot switch it back. Existing
module collections are reused and peer source metadata is preserved.

When direct fetch is enabled, new originals use the bounded Microsoft identity
checks and provider-to-provider route described in
[COACH_RECORDING_CUTOVER.md](COACH_RECORDING_CUTOVER.md). That path does not store
or re-upload full media on AWS and does not silently fall back to the local
transfer. Source ambiguities remain blocked for reconciliation.

With direct fetch disabled, originals are downloaded to the worker's bounded temporary file, hashed
with SHA-256, then uploaded from that same file. A unique `live_source` journal
claim for the exact bytes and authorized occurrence scope gives simultaneous
Graph aliases one upload owner and one Bunny GUID. Retries retain that owner;
changed bytes require a source-version review. Source hashes do not deduplicate
different occurrences or authorization scopes. Historical peer uploads without
a verifiable source/hash still require the reviewed manifest; no title/duration
guessing is used. Microsoft application bearer tokens never go to Bunny or a
preauthenticated SharePoint fallback URL.

Rollback: disable new original uploads, drain the worker, and use the retained
historical journal/projection for a specifically reviewed rollback. Do not delete
either original, clear import IDs, recreate Teams meetings, or rerun all sources.

## Request for the peer-system owner

The following is a handoff draft; sending it or stopping their uploader is a
separate coordinated step after readiness checks, not an instruction to stop now.

> The LMS will own original Microsoft/SharePoint-to-Bunny transfers. Materials
> and Free Courses stay in Curriculum; live originals belong in LiveSessions,
> in their saved module collection, with that same GUID used by the LMS component.
>
> First, provide the definition of `kbc_recording_identity` and a private manifest
> mapping existing originals to the exact Microsoft recording/SharePoint file
> ID and version, LMS occurrence, part, peer record ID, Bunny library and GUID.
> Include source IDs rather than titles or expiring download URLs. Do not include
> tokens, API keys, student lists or meeting join links.
>
> Prepare check-only mode for every original-upload entry point: worker, cron,
> retry queue, backfill and manual repair. Once we confirm readiness, stop new
> original uploads, drain in-flight originals and acknowledge that no remaining
> process can create/fetch/upload an original. Keep checks, clips and reports.
>
> After the coordinated LMS switch, inspect the original produced by the LMS.
> Match its canonical recording identity, library/GUID, module collection and LMS
> component/week. Record pending/processing/ready/failed results and reasons.
> Missing media requests LMS investigation/repair; it never starts a second
> SharePoint-to-Bunny original transfer. Clips retain a reference to the LMS
> original and must not masquerade as or replace that original.
