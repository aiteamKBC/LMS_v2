import { useContext } from 'react';
import { AuthContext, type RbacContextValue } from './authContext';
export type { AuthState, RbacContextValue } from './authContext';

export function useAuth(): RbacContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
