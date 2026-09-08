import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { AiSettingsProvider } from '@/hooks/useAiSettings';
import { ToastProvider } from '@/hooks/useToast';
import { ToastContainer } from '@/components/feature/ToastContainer';
import { AppRoutes } from '@/router';
import { ThemeProvider } from '@/hooks/useTheme';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter basename={__BASE_PATH__}>
        <ToastProvider>
          <AiSettingsProvider>
            <AuthProvider>
              <AppRoutes />
              <ToastContainer />
            </AuthProvider>
          </AiSettingsProvider>
        </ToastProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
