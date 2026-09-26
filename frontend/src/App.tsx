import { InclusionSignIn } from '@/components/InclusionSignIn';
import { BrowserRouter } from 'react-router-dom';
import { SafeguardingSignIn } from '@/components/SafeguardingSignIn';
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
              <InclusionSignIn><SafeguardingSignIn><AppRoutes /></SafeguardingSignIn></InclusionSignIn>
              <ToastContainer />
            </AuthProvider>
          </AiSettingsProvider>
        </ToastProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
