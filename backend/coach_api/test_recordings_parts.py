"""Physical-call boundaries and metadata-only discovery; no external effects."""
from copy import deepcopy
from datetime import datetime,timezone,timedelta
from django.test import SimpleTestCase
from .recordings_parts import occurrence_parts,evidence_metadata,merge_transcripts


class RecordingPartsTests(SimpleTestCase):
    def test_every_verified_continuation_is_retained_across_a_chain_in_any_provider_order(self):
        window=('2026-10-19T09:00:00Z','2026-10-19T10:00:00Z')
        first={'id':'first','createdDateTime':window[0],'endDateTime':'2026-10-19T09:05:00Z','callId':'physical-one','contentCorrelationId':'one'}
        second={'id':'second','createdDateTime':'2026-10-19T10:00:00Z','endDateTime':'2026-10-19T10:05:00Z','callId':'physical-one','contentCorrelationId':'two'}
        third={'id':'third','createdDateTime':'2026-10-19T10:06:00Z','endDateTime':'2026-10-19T10:10:00Z','callId':'physical-two','contentCorrelationId':'two'}
        foreign={**third,'id':'different-occurrence','callId':'different-call','contentCorrelationId':'different-correlation','onlineMeetingId':'reused-link'}
        for rows in ([third,foreign,second,first],[first,second,third,foreign],[second,third,first,first]):
            self.assertEqual([row['id'] for row in occurrence_parts(rows,window)],['first','second','third'])
        self.assertEqual(occurrence_parts([second,third,foreign],window),[])
        self.assertEqual([row['id'] for row in occurrence_parts([third,second],window,anchors=[first])],['second','third'])

    def test_invalid_artifact_cannot_anchor_a_different_occurrence_by_its_call_id(self):
        window=('2026-10-19T09:00:00Z','2026-10-19T10:00:00Z')
        anchor={'createdDateTime':window[0],'endDateTime':window[1],'callId':'call'}
        future={'id':'future','createdDateTime':window[1],'endDateTime':'2026-10-19T10:10:00Z','callId':'call'}
        self.assertEqual(occurrence_parts([anchor,future],window),[])

    def test_reconnections_and_parts_are_ordered_deduplicated_and_call_scoped(self):
        start=datetime(2026,10,23,12,tzinfo=timezone.utc);end=start+timedelta(hours=1)
        def row(identity,begin,last,call):
            return {'id':identity,'createdDateTime':begin.isoformat(),'endDateTime':last.isoformat(),'callId':call}
        first=row('one',start,end,'verified-call')
        second=row('two',end,end+timedelta(minutes=15),'verified-call')
        other=row('other',end,end+timedelta(minutes=30),'next-meeting')
        reconnect=row('reconnect',start+timedelta(minutes=15),start+timedelta(minutes=30),'second-call')
        short={**first,'endDateTime':(start+timedelta(minutes=5)).isoformat()}
        selected=occurrence_parts([short,second,other,first,first,reconnect],(start,end))
        self.assertEqual([value['id'] for value in selected],['one','reconnect','two'])
        self.assertEqual(selected[0]['endDateTime'],end.isoformat())
        self.assertEqual(occurrence_parts([second],(start,end)),[])
        self.assertEqual(occurrence_parts([second],(start,end),anchors=[first]),[second])
        self.assertEqual(occurrence_parts([{**second,'endDateTime':None}],(start,end),anchors=[first]),[])

    def test_transcript_correlation_can_link_a_part_to_an_anchored_recording(self):
        window=('2026-10-23T12:00:00Z','2026-10-23T13:00:00Z')
        anchor={'id':'file','createdDateTime':window[0],'endDateTime':window[1],'contentCorrelationId':'same'}
        part={'id':'transcript','createdDateTime':window[1],'endDateTime':'2026-10-23T13:10:00Z','contentCorrelationId':'same'}
        self.assertEqual(occurrence_parts([part],window,anchors=[anchor]),[part])

    def test_drawer_metadata_omits_large_bodies_without_mutating_the_pdf_source(self):
        data={'state':'matched','transcript':{'content':'Private transcript '*10000,'partCount':2,'durationSeconds':None,'updatedAt':None},
            'analyses':[{'id':'report','status':'completed','report':{'summary':'Private report '*1000}}]}
        before=deepcopy(data);result=evidence_metadata(data)
        self.assertNotIn('content',result['transcript']);self.assertNotIn('report',result['analyses'][0])
        self.assertTrue(result['analyses'][0]['reportAvailable']);self.assertTrue(result['metadataOnly'])
        self.assertEqual(data,before)

    def test_partial_saved_transcripts_are_merged_and_duplicate_copies_do_not_repeat(self):
        first={'content':'First part','durationSeconds':10,'updatedAt':None}
        second={'content':'Second part','durationSeconds':20,'updatedAt':None}
        result=merge_transcripts(first,second,dict(first))
        self.assertEqual(result['content'],'First part\n\nSecond part');self.assertEqual(result['partCount'],2)
        self.assertIsNone(result['durationSeconds'])
