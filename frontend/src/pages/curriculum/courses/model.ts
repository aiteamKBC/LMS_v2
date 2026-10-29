import type { CurriculumCourseType, FreeProgrammeModule } from '@/lib/curriculumApi';

export interface CourseCard {
  key: string;
  courseId: string;
  courseType: CurriculumCourseType;
  title: string;
  description: string;
  coverImageUrl: string;
  weeks: FreeProgrammeModule[];
  componentCount: number;
  totalOtjh: number;
}

export function courseCardKey(module: FreeProgrammeModule) {
  return module.courseId || `${module.courseType || 'free'}::${module.courseName || module.title || 'Untitled course'}::${module.description || ''}`;
}

export function groupCourses(modules: FreeProgrammeModule[]): CourseCard[] {
  const groups = new Map<string, CourseCard>();
  for (const module of modules) {
    const key = courseCardKey(module);
    let card = groups.get(key);
    if (!card) {
      card = { key, courseId: module.courseId || module.id, courseType: module.courseType || 'free',
        title: module.courseName || module.title || 'Untitled course', description: module.description || '',
        coverImageUrl: module.coverImageUrl || '', weeks: [], componentCount: 0, totalOtjh: 0 };
      groups.set(key, card);
    }
    card.weeks.push(module);
    card.componentCount += module.componentCount ?? module.components?.length ?? 0;
    card.totalOtjh += Number(module.totalOtjh || 0);
  }
  return [...groups.values()].map(card => ({ ...card,
    weeks: [...card.weeks].sort((a, b) => Number(a.weekNumber || 0) - Number(b.weekNumber || 0)),
    totalOtjh: Math.round(card.totalOtjh * 100) / 100,
  }));
}

export function filterCourses(cards: CourseCard[], type: 'all' | CurriculumCourseType, query: string) {
  const term = query.trim().toLocaleLowerCase();
  return cards.filter(card => (type === 'all' || card.courseType === type)
    && (!term || [card.title, card.description, ...card.weeks.map(week => week.weekTitle || '')]
      .some(value => value.toLocaleLowerCase().includes(term))));
}
