import { expect, it } from 'vitest';
import { previewUrl } from './previewUrl';

it('preserves Drive resource keys and spreadsheet sheet selection', () => {
  expect(previewUrl('https://drive.google.com/file/d/abc/view?resourcekey=access-key&usp=sharing'))
    .toBe('https://drive.google.com/file/d/abc/preview?resourcekey=access-key');
  expect(previewUrl('https://drive.google.com/drive/u/0/folders/abc?resourcekey=key'))
    .toBe('https://drive.google.com/embeddedfolderview?id=abc&resourcekey=key#list');
  expect(previewUrl('https://docs.google.com/spreadsheets/d/abc/edit?gid=7#gid=7'))
    .toBe('https://docs.google.com/spreadsheets/d/abc/preview?gid=7#gid=7');
});

it('preserves the start point and playlist of a YouTube recording', () => {
  expect(previewUrl('https://youtu.be/lesson?t=1m30s&list=course')).toBe('https://www.youtube.com/embed/lesson?list=course&start=90');
  expect(previewUrl('https://www.youtube.com/live/recording')).toBe('https://www.youtube.com/embed/recording');
});

it('opens podcasts and unlisted Vimeo videos in their actual player', () => {
  expect(previewUrl('https://open.spotify.com/episode/123abc?si=share')).toBe('https://open.spotify.com/embed/episode/123abc');
  expect(previewUrl('https://vimeo.com/12345/privateHash')).toBe('https://player.vimeo.com/video/12345?h=privateHash');
});

it('preserves signed file parameters and existing published embeds', () => {
  const url = 'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/material/1/view?token=test&attachment_id=2';
  expect(previewUrl(url)).toBe(url);
  const published = 'https://docs.google.com/presentation/d/e/published-id/embed?start=false';
  expect(previewUrl(published)).toBe(published);
  const file = 'https://example.org/slides.pptx?signature=test';
  expect(new URL(previewUrl(file)).searchParams.get('src')).toBe(file);
});

it('matches provider hosts exactly and never enables executable URLs', () => {
  expect(previewUrl('https://drive.google.com.attacker.example/file/d/abc/view')).toBe('https://drive.google.com.attacker.example/file/d/abc/view');
  expect(previewUrl('javascript:alert(1)')).toBe('');
});
