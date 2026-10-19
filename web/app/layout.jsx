import './globals.css';
import { Shell } from '@/components/Shell';

export const metadata = { title: 'DATYLUNE AI OS', description: 'Governed multi-agent operations for DATYLUNE SOLUTIONS' };

export default function RootLayout({ children }) {
  return <html lang="en"><body><Shell>{children}</Shell></body></html>;
}
