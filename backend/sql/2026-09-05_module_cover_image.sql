-- Optional module artwork, shown on the Module Builder card in place of the
-- generic layout/draft icon. Stored the same way a free course stores its
-- cover: either a pasted image URL or a data: URL read off the picked file,
-- so no upload endpoint or object store is involved.
--
-- Safe to re-run. Existing rows keep a null cover and go on rendering the icon.
alter table curriculum."modules"
  add column if not exists cover_image_url text;
