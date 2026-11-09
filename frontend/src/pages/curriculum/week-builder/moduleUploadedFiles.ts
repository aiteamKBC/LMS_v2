// Files already uploaded somewhere in the module, offered for reuse.
//
// An upload is stored as a stable path (/curriculum_api/curriculum/uploads/...)
// and served by path, so a second component can point at the same file
// instead of uploading a copy. Removing it from one component only edits that
// component's list; the stored file is never deleted, so sharing is safe.

import { assignmentTopics } from '@/lib/assignmentTopics';
import { componentFileList, legacyComponentFile, type ComponentFile } from '@/lib/componentFiles';
import type { RecordingLinkWeek } from '@/pages/curriculum/shared/entities/liveSessionRecordingLink';
import type { StoredModuleUpload } from './weekTemplateData';

const UPLOAD_PATH = /^\/curriculum_api\/curriculum\/uploads\//;

export interface ModuleUploadedFile {
  file: ComponentFile;
  /** Where it is used, e.g. "Week 1 · Reading Material 2". First use wins. */
  source: string;
  /** Set instead of `source` for a stored file no component uses. */
  note?: string;
}

/**
 * Every uploaded file in `weeks`, once each, in week and component order.
 * Web links are not uploads and are left out.
 */
export function moduleUploadedFiles(weeks: RecordingLinkWeek[]): ModuleUploadedFile[] {
  const seen = new Set<string>();
  const found: ModuleUploadedFile[] = [];
  for (const week of weeks) {
    for (const component of week.components) {
      const settings = component.settings || {};
      const files: ComponentFile[] = [
        ...componentFileList(
          settings.componentFiles,
          legacyComponentFile(
            settings.uploadedFileUrl || settings.resourceUrl || settings.podcastUrl,
            settings.uploadedFileName || settings.fileName,
            settings.uploadedFileSize,
            settings.uploadedFileContentType,
          ),
        ),
        ...assignmentTopics(settings.assignmentTopics).flatMap(topic => topic.resources.filter(resource => !resource.link)),
      ];
      const source = [week.label, component.title].filter(Boolean).join(' · ');
      for (const file of files) {
        if (!UPLOAD_PATH.test(file.url) || seen.has(file.url)) continue;
        seen.add(file.url);
        found.push({ file: { fileName: file.fileName, url: file.url, size: file.size, contentType: file.contentType }, source });
      }
    }
  }
  return found;
}

/**
 * The attached files followed by stored files no component uses any more.
 * A stored file names the component it was uploaded for; when that component
 * is still in the module, say so, so the author can tell files apart.
 */
export function withStoredUploads(attached: ModuleUploadedFile[], stored: StoredModuleUpload[], weeks: RecordingLinkWeek[]): ModuleUploadedFile[] {
  const seen = new Set(attached.map(item => item.file.url));
  const where = new Map<string, string>();
  for (const week of weeks) {
    for (const component of week.components) where.set(component.id, [week.label, component.title].filter(Boolean).join(' · '));
  }
  const unattached = stored
    .filter(item => UPLOAD_PATH.test(item.url) && !seen.has(item.url))
    .map(item => ({
      file: { fileName: item.fileName, url: item.url, size: Number(item.size) || 0, contentType: item.contentType || '' },
      source: '',
      note: where.has(item.componentId) ? `Not attached · uploaded for ${where.get(item.componentId)}` : 'Not attached to any component',
    }));
  return [...attached, ...unattached];
}
