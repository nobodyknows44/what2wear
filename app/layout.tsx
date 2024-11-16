import './globals.css'
import { Inter } from 'next/font/google'
import { NotificationProvider } from './components/NotificationContext'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'What2Wear.Today',
  description: 'Real-time weather, real-time style.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} md:fixed md:inset-0 md:overflow-hidden overflow-auto min-h-screen`}>
        <NotificationProvider>
          {children}
        </NotificationProvider>
      </body>
    </html>
  )
}