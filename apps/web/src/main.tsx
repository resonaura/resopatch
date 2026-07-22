import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { addCollection } from '@iconify/react';
import fontaudioIcons from '@iconify-json/fad/icons.json';
import App from './App';
import './styles.css';

// Registered locally so device icons render without a call out to the Iconify API — this needs
// to work on a venue's flaky wifi, not just at home.
addCollection(fontaudioIcons);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
