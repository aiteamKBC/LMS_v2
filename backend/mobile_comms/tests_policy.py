import unittest
from datetime import datetime, timezone
from .policy import default_preferences, validate_preferences, reminder_plan, eligible_now

class ReminderPolicyTests(unittest.TestCase):
    def event(self, **changes):
        return {"kind":"session", "key":"session:1", "startsAt":"2026-10-25T10:00:00+00:00", **changes}
    def test_three_meeting_stages(self):
        rows = reminder_plan(self.event())
        self.assertEqual([r["category"] for r in rows], ["meetings","meetings","attendance"])
        self.assertEqual(rows[1]["dueAt"].isoformat(), "2026-10-25T09:45:00+00:00")
        self.assertEqual(rows[2]["dueAt"].isoformat(), "2026-10-25T10:15:00+00:00")
    def test_day_before_uses_uk_day_across_dst(self):
        self.assertEqual(reminder_plan(self.event())[0]["dueAt"].isoformat(), "2026-10-24T09:00:00+00:00")
    def test_attendance_stops_late_alert(self):
        self.assertEqual(len(reminder_plan(self.event(attended=True))), 2)
    def test_excused_and_cancelled_stop_reminders(self):
        for flag in ("authorisedAbsence", "cancelled", "completed"):
            self.assertEqual(reminder_plan(self.event(**{flag:True})), [])
    def test_assignment_reminds_one_and_two_days_before(self):
        event={"kind":"assignment","key":"assignment:7","dueAt":"2026-10-21T17:00:00+01:00"}
        self.assertEqual([r["dueAt"].day for r in reminder_plan(event)], [19,20])
    def test_submitted_stops_assignment_reminders(self):
        self.assertEqual(reminder_plan({"kind":"assignment","key":"7","submitted":True}), [])
    def test_tasks_have_separate_category(self):
        rows=reminder_plan({"kind":"task","key":"8","dueAt":"2026-10-21T17:00:00+01:00"})
        self.assertTrue(all(r["category"]=="tasks" for r in rows))
    def test_does_not_send_early_or_old_alert(self):
        row=reminder_plan(self.event())[1]
        for instant in ("2026-10-25T09:44:00Z","2026-10-25T10:00:00Z"):
            self.assertFalse(eligible_now(row,self.event(),datetime.fromisoformat(instant)))
        self.assertTrue(eligible_now(row,self.event(),datetime.fromisoformat("2026-10-25T09:46:00Z")))
    def test_reschedule_invalidates_old_job(self):
        row=reminder_plan(self.event())[1]
        self.assertFalse(eligible_now(row,self.event(startsAt="2026-10-26T10:00:00Z"),row["dueAt"]))
    def test_attendance_rechecked_at_dispatch(self):
        row=reminder_plan(self.event())[2]
        self.assertFalse(eligible_now(row,self.event(attended=True),row["dueAt"]))
    def test_preferences_are_explicit(self):
        prefs=default_preferences()
        self.assertEqual(validate_preferences(prefs),prefs)
        self.assertTrue(all(v["inApp"] and not v["push"] for v in prefs.values()))
        prefs["meetings"]["push"]=True
        self.assertFalse(default_preferences()["meetings"]["push"])
    def test_rejects_invalid_preferences(self):
        for bad in ({}, {"messages":True}, []):
            with self.assertRaises(ValueError):validate_preferences(bad)
        prefs=default_preferences();prefs["tasks"]["push"]="yes"
        with self.assertRaises(ValueError):validate_preferences(prefs)
    def test_rejects_unzoned_time(self):
        with self.assertRaises(ValueError):reminder_plan(self.event(startsAt="2026-10-25T10:00:00"))
