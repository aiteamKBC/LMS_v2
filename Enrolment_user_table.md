
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Address" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Age" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Legal_Sex" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Current_postcode" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Current_address_line_1" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Current_address_line_2" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Current_address_line_3" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Current_address_line_4" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "How_long_have_you_been_at_this_address_(years)?" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Postcode_prior_to_enrolment" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "National_insurance_number" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "What_pronouns_do_you_use?" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Ethnicity" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Do_you_consider_yourself_to_have_a_long_term_disability_,_health_problem_or_any_learning_difficulties?" json;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Contact_Preferences" json;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Emergency_contact_details " json;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Eligibility" json;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Other_training" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Personal_Circumstances" json;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Additional_information" json;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Media_Consent" text;
ALTER TABLE "enrolment"."Enrolment_Users"
ADD COLUMN "Declarations_/_consents" text;