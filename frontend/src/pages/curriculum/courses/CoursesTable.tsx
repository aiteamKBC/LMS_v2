import { AppIcon } from '@/components/feature/AppIcon';
import { ArrowLeftRight } from 'lucide-react';
import { formatHoursMinutes } from '@/lib/format';
import type { CourseCard } from './model';
import styles from './CoursesPage.module.css';

interface CoursesTableProps {
  courses: CourseCard[];
  onEdit: (course: CourseCard) => void;
  onConvert: (course: CourseCard) => void;
  onDelete: (course: CourseCard) => void;
}

export default function CoursesTable({ courses, onEdit, onConvert, onDelete }: CoursesTableProps) {
  return (
    <div className={styles.tableScroll} role="region" aria-label="Course table" tabIndex={0}>
      <table className={styles.table} aria-label="Courses">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Type</th>
            <th scope="col" className={styles.numberCell}>Weeks</th>
            <th scope="col" className={styles.numberCell}>Components</th>
            <th scope="col" className={styles.hoursCell}>OTJH</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {courses.map(course => (
            <tr key={course.key}>
              <th scope="row" className={styles.courseCell}>
                <span className={styles.courseTitle}>{course.title}</span>
                <span className={styles.courseDescription} title={course.description || undefined}>
                  {course.description || 'No description added yet.'}
                </span>
              </th>
              <td><span className={styles.courseKind} data-course-type={course.courseType}>{course.courseType === 'apprentices' ? 'Apprentices' : 'Free'}</span></td>
              <td className={styles.numberCell}>{course.weeks.length}</td>
              <td className={styles.numberCell}>{course.componentCount}</td>
              <td className={styles.hoursCell}>{formatHoursMinutes(course.totalOtjh) || '0h'}</td>
              <td>
                <div className={styles.tableActions}>
                  <button type="button" className={styles.editAction} onClick={() => onEdit(course)}>
                    <AppIcon name="ri-edit-2-line" size={14} /> Edit
                  </button>
                  <button type="button" onClick={() => onConvert(course)}>
                    <ArrowLeftRight size={14} aria-hidden="true" /> Convert to programme
                  </button>
                  <button type="button" className={styles.deleteAction} aria-label={`Delete ${course.title}`} onClick={() => onDelete(course)}>
                    <AppIcon name="ri-delete-bin-line" size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
