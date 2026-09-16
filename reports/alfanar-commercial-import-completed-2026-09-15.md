# Al Fanar commercial import completed

Verified at 2026-09-14T21:44:56.492790+00:00 (UTC).

**Committed and verified: 26 new Users records and 26 linked learner profiles. The full selected roster of 28 records is present as commercial / Delivery.**

- Gary Beacham (Users 291, profile 593) and Joshua Bowers (Users 348, profile 549) were preserved without changing any saved fields, plans or progress.
- Both Adam emails were imported as separate records per the owner instruction; neither shared phone nor name resemblance caused a merge.
- Nawaf Rashed was imported as Users 568 / profile 704. Abdullah Nawaf remains a separate record, Users 552 / profile 688.
- The new Users IDs are 548?573; their profile IDs are 684?709. Each pair shares its own UUID and correct enrolment_id; the two tables retain independent primary keys.
- The 19 verified source Aptem IDs were preserved. The seven candidates absent from the current source retain no Aptem ID; no ID was invented or copied from another person.
- New records include the supplied names, normalized emails, original phone strings, and AL Fanar organisation/employer labels.
- New programme, cohort, group, dates, coach and learning plans remain unassigned for the later setup stage. Gary and Joshua retain their existing placement.
- No login accounts or invitation records were created; no email was sent. All 28 selected learners have no matching login account at verification time.

## Validation

The preflight used read-only source and destination transactions, checked the exact approved roster hash, matched Aptem IDs/emails and checked name/phone conflicts. The import wrote both target tables in one transaction under short-lived locks. Before commit, it verified exact table count increases and complete preservation of existing rows. A fresh read-only transaction then verified persistence and all 28 linked commercial Delivery records.

## Completed roster

| Name | Email | Users ID | Profile ID | Result |
| --- | --- | ---: | ---: | --- |
| Abdulaziz Hamoud | abdulaziz.aldaham@alfanar.com | 548 | 684 | Created |
| Abdulaziz Hassan | abdulaziz.ghazwani@alfanar.com | 550 | 686 | Created |
| Abdulaziz Mohammed | abdulaziz.alhijris@alfanar.com | 549 | 685 | Created |
| Abdulhakim Musallam | abdulhakim.almarshadi@alfanar.com | 551 | 687 | Created |
| Abdullah Nawaf | abdullah.almutrif@alfanar.com | 552 | 688 | Created |
| Abdulrahman Saad | abdulrahman.alsahli@alfanar.com | 553 | 689 | Created |
| Abdulsalam Abdulqader | abdulsalam.alsalehi@alfanar.com | 554 | 690 | Created |
| Adam Alrasheed | adam.alrasheed@alfanar.com | 555 | 691 | Created |
| Adam Nayef | ahmed.alrasheed@alfanar.com | 556 | 692 | Created |
| Ahmed Said | ahmed.skhalifa@dar-engineering.com | 557 | 693 | Created |
| Alghareeb Atef | alghareeb.hegazy@alfanar.com | 558 | 694 | Created |
| Barkat Muhammad | barakat.muhammad@alfanar.com | 559 | 695 | Created |
| Faisal Saoud | faisal.almutairi@alfanar.com | 560 | 696 | Created |
| Gary Beacham | garybeacham@duck.com | 291 | 593 | Preserved existing |
| Hossam Khairy | hossam.abdelrassoul@alfanar.com | 561 | 697 | Created |
| Joshua Bowers | joshuab@sarginsons.co.uk | 348 | 549 | Preserved existing |
| Khalid Bashir | khalid.bashir@alfanar.com | 563 | 699 | Created |
| Khalid Nasser | khalid.binafif@alfanar.com | 564 | 700 | Created |
| Khalid Yusof | khalid.alwashmi@alfanar.com | 562 | 698 | Created |
| Manishkumar Mahendra | manishkumar.varde@alfanar.com | 565 | 701 | Created |
| Mohammed Khalid | mohammed.alangari@alfanar.com | 567 | 703 | Created |
| Muhammad Usman | mohammad.khan@alfanar.com | 566 | 702 | Created |
| Nawaf Rashed | nawaf.altwalah@alfanar.com | 568 | 704 | Created |
| Othman Hasan | othman.milhem@alfanar.com | 569 | 705 | Created |
| Salman Yousef | salman.alasqah@alfanar.com | 570 | 706 | Created |
| Samer Aali | samer.alsalmi@alfanar.com | 571 | 707 | Created |
| Sulaiman Mohammed | sulaiman.alhogail@alfanar.com | 572 | 708 | Created |
| Ziyad Mohammed | ziyad.almushawwah@alfanar.com | 573 | 709 | Created |

Execution snapshot: [alfanar-commercial-import-20260914T214448276174Z-result.json](alfanar-commercial-import-20260914T214448276174Z-result.json).

Pre-import snapshot: [alfanar-commercial-import-20260914T214448276174Z-before.json](alfanar-commercial-import-20260914T214448276174Z-before.json).
