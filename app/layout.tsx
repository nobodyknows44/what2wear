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
      <body className={inter.className}>
        <NotificationProvider>
          {children}
          <footer className="fixed bottom-0 left-0 right-0 bg-transparent text-white p-4 text-center">
            <p className="text-sm">2024 What2Wear.Today. Linkedin @alexkopytin</p>
          </footer>
        </NotificationProvider>
      </body>
    </html>
  )
}
