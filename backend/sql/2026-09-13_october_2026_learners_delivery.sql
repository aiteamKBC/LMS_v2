-- Set the 30 learners imported from october 2026/*.md to Delivery.
-- Programme_status is the delivery stage; account Status stays unchanged.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE enrolment."Created_users", "Learner".learners IN SHARE ROW EXCLUSIVE MODE;
DO $delivery$
DECLARE
  emails CONSTANT text[] := ARRAY[
  'ilaria.piscopo@prsformusic.com',
  'm.bramall@aiglobalmedialtd.com',
  'owenwilliams@choiceinsuranceagency.com',
  'bethany.cobley@warrantyfirst.co.uk',
  'danielleroberts@southdevon.ac.uk',
  'liz.hughes@provendernurseries.co.uk',
  'mae@sw-hire.co.uk',
  'stephanie.smith@avenuesgroup.org.uk',
  'caris.champion@hcmediagroup.co.uk',
  'marketing@nkholidays.co.uk',
  'katie.jenkin@outco.co.uk',
  'la2073@bath.ac.uk',
  'fayebaker@wilsonandscott.co.uk',
  'callum@ssaltd.net',
  'amber.insch@promega.com',
  'jdack@eastnorfolk.ac.uk',
  'flora.donnelly@htmltd.co.uk',
  'admin@pklacey.co.uk',
  'summer.thompson@aimbridge.com',
  'alexandrac@vikingmaritime.co.uk',
  'laila.rees@uknnl.com',
  'jordan@stadion.io',
  'hannahmaclellan@b-gen.co.uk',
  'shelley.cant@neneparktrust.org.uk',
  'ktezcan@gmail.com',
  'rachel.whittle@uk.bmt.org',
  'prashanth.sivalingam@taylorwoodrow.com',
  'katie.johnson@inntel.co.uk',
  'melanie.green@bristolairport.com',
  'melissa.barr@inaphaea.com'
  ];
  changed integer;
BEGIN
  IF (SELECT count(*) FROM enrolment."Created_users"
      WHERE lower(btrim("Email")) = ANY(emails)) <> 30
     OR (SELECT count(*) FROM "Learner".learners
         WHERE lower(btrim(email)) = ANY(emails)) <> 30
     OR (SELECT count(*) FROM enrolment."Created_users" e
         JOIN "Learner".learners l ON l.enrolment_id = e.id AND l.uuid = e.uuid
         WHERE lower(btrim(e."Email")) = ANY(emails)
           AND lower(btrim(l.email)) = lower(btrim(e."Email"))) <> 30 THEN
    RAISE EXCEPTION 'Expected exactly 30 linked enrolment and learner records';
  END IF;

  UPDATE enrolment."Created_users"
  SET "Programme_status" = 'Delivery'
  WHERE lower(btrim("Email")) = ANY(emails);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 30 THEN RAISE EXCEPTION 'Expected 30 enrolments, got %', changed; END IF;

  UPDATE "Learner".learners
  SET programme_status = 'Delivery', lifecycle_status = 'delivery', updated_at = now()
  WHERE lower(btrim(email)) = ANY(emails);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 30 THEN RAISE EXCEPTION 'Expected 30 profiles, got %', changed; END IF;

  IF (SELECT count(*) FROM enrolment."Created_users" e
      JOIN "Learner".learners l ON l.enrolment_id = e.id AND l.uuid = e.uuid
      WHERE lower(btrim(e."Email")) = ANY(emails)
        AND lower(btrim(l.email)) = lower(btrim(e."Email"))
        AND e."Programme_status" = 'Delivery'
        AND l.programme_status = 'Delivery' AND l.lifecycle_status = 'delivery') <> 30 THEN
    RAISE EXCEPTION 'Delivery status verification failed';
  END IF;
END;
$delivery$;
COMMIT;
