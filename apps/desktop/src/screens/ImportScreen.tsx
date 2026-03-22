import { useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';

export function ImportScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();

  return (
    <div style={{ padding: 24, color: theme.colors.text }}>
      <button onClick={() => navigate('/vault/settings')} style={{ marginBottom: 16 }}>
        &larr; Back
      </button>
      <h1>Import Passwords</h1>
      <p>Coming soon</p>
    </div>
  );
}
