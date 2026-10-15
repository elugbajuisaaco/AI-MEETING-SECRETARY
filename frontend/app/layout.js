import './globals.css';

export const metadata = {
  title: 'AI Meeting Secretary',
  description: 'Meeting transcription, summaries, decisions, and action items.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
