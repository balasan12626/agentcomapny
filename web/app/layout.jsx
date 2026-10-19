import './globals.css';
import { Shell } from '@/components/Shell';
import { THEME_BOOT } from '@/components/ThemeSwitch';

export const metadata = {
  title: { default: 'DATYLUNE AI OS', template: '%s · DATYLUNE AI OS' },
  description: 'Governed multi-agent operations for DATYLUNE SOLUTIONS',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }) {
  // data-theme is set before paint by THEME_BOOT, hence suppressHydrationWarning.
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
