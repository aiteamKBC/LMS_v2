import { describe, expect, it } from "vitest";

import { arrangeLmsLectureRows, lectureNumber, orderLmsLectureRows, type LmsLectureRow } from "./lectureOrdering";

type TestRow = LmsLectureRow & { key: string };

function row(
  key: string,
  title: string,
  category: string,
  activityDate = "2025-07-04",
  sourceRef = "la:60200:1",
): TestRow {
  return { key, title, category, activity_date: activityDate, source_ref: sourceRef };
}

describe("LMS lecture ordering", () => {
  it("recognises the lecture aliases used by video, reading and quiz titles", () => {
    expect(lectureNumber("P3-Brand Positioning")).toBe(3);
    expect(lectureNumber("VID 3-Brand Positioning")).toBe(3);
    expect(lectureNumber("Q3-Brand Positioning")).toBe(3);
    expect(lectureNumber("PPT-L6-Diagnosing Pain Points")).toBe(6);
    expect(lectureNumber("Lecture 10: Project control")).toBe(10);
  });

  it("puts each lecture first and its reading+quiz components directly below it", () => {
    const rows = [
      row("p10-ppt", "P10-PPT-Final topic", "reading+quiz"),
      row("p2-textbook", "P2-Textbook-Adoption of Innovation", "reading+quiz"),
      row("p1-textbook", "P1-Textbook-Customer Behaviour", "reading+quiz"),
      row("p2-video", "P2-Adoption of Innovation 4/7/2025", "video"),
      row("p1-ppt", "P1-PPT-Customer Behaviour", "reading+quiz"),
      row("p1-video", "P1-Customer Behaviour 4/7/2025", "video"),
      row("p10-video", "P10-Final topic 4/7/2025", "video"),
      row("p2-ppt", "P2-PPT-Adoption of Innovation", "reading+quiz"),
    ];

    expect(orderLmsLectureRows(rows).map((item) => item.key)).toEqual([
      "p1-video", "p1-ppt", "p1-textbook",
      "p2-video", "p2-ppt", "p2-textbook",
      "p10-video", "p10-ppt",
    ]);
  });

  it("bundles VID/P/Q aliases for the same course and teaching day", () => {
    const rows = [
      row("q1", "Q1-Conducting Customer Journey Audit", "reading+quiz"),
      row("p1", "P1-PPT-Conducting Customer Journey Audit", "reading+quiz"),
      row("vid1", "VID 1-Conducting Customer Journey Audit", "video"),
      row("vid2", "VID 2-Using Personas", "video"),
      row("p2", "P2-PPT-Using Personas", "reading+quiz"),
    ];

    expect(orderLmsLectureRows(rows).map((item) => item.key)).toEqual([
      "vid1", "p1", "q1", "vid2", "p2",
    ]);
  });

  it("keeps dates and LMS courses separate before ordering lecture numbers", () => {
    const rows = [
      row("later-p1", "P1-Later lecture", "video", "2025-07-07", "la:20:1"),
      row("course-b-p1", "P1-Course B", "video", "2025-07-04", "la:20:2"),
      row("course-a-p2", "P2-Course A", "video", "2025-07-04", "la:10:3"),
      row("course-a-p1", "P1-Course A", "video", "2025-07-04", "la:10:4"),
    ];

    expect(orderLmsLectureRows(rows).map((item) => item.key)).toEqual([
      "course-a-p1", "course-a-p2", "course-b-p1", "later-p1",
    ]);
  });

  it("matches an unnumbered media title to its numbered Q+R component by topic", () => {
    const rows = [
      row("part1", "Part 1-What is Project?", "video", "2026-06-10", "la:115:1"),
      row("q3", "Q3: PMI Code of Ethics and Professional Conduct Assessment", "reading+quiz", "2026-06-10", "la:115:2"),
      row("part2", "Part 2 - Project Fundamentals and Value Delivery", "video", "2026-06-10", "la:115:3"),
      row("ethics", "PMI Code of Ethics - pdf", "audio", "2026-06-10", "la:115:4"),
      row("q2", "Q2: Project Fundamentals and Value Delivery", "reading+quiz", "2026-06-10", "la:115:5"),
    ];

    const arranged = arrangeLmsLectureRows(rows);
    expect(arranged.rows.map((item) => item.key)).toEqual([
      "part1", "part2", "q2", "ethics", "q3",
    ]);
    expect([...arranged.nestedRowKeys]).toEqual(expect.arrayContaining(["q2", "q3"]));
  });

  it("nests audio, reading and quiz beneath a matching video lecture", () => {
    const rows = [
      row("q1", "Q1-Customer Behaviour Quiz", "reading+quiz"),
      row("audio1", "AUD 1-Customer Behaviour Podcast", "audio"),
      row("reading1", "R1-Textbook-Customer Behaviour", "reading+quiz"),
      row("video1", "VID 1-Customer Behaviour", "video"),
    ];

    const arranged = arrangeLmsLectureRows(rows);
    expect(arranged.rows.map((item) => item.key)).toEqual([
      "video1", "audio1", "reading1", "q1",
    ]);
    expect([...arranged.nestedRowKeys]).toEqual(expect.arrayContaining([
      "audio1", "reading1", "q1",
    ]));
    expect(arranged.bundleRowKeysByPrimary.get("video1")).toEqual([
      "audio1", "reading1", "q1",
    ]);
  });
});
