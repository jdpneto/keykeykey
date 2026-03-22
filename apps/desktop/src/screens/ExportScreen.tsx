import { useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';

export function ExportScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();

  return (
    <div style={{ padding: 24, color: theme.colors.text }}>
      <button onClick={() => navigate('/vault/settings')} style={{ marginBottom: 16 }}>
        &larr; Back
      </button>
      <h1>Export Vault</h1>
      <p>Coming soon</p>
    </div>
  );
}
