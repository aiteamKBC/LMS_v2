import { createContext } from 'react';
import type { ModuleCollaboration } from './useModuleCollaboration';

export const CollaborationContext = createContext<ModuleCollaboration | null>(null);
