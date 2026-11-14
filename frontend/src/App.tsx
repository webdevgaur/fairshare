import { ClerkProvider, SignedIn, SignedOut, UserButton } from '@clerk/react'
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import GroupPage from './pages/GroupPage'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ''

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">FairShare</h1>
          <p className="text-slate-500 mt-1 text-sm">Split expenses, not friendships</p>
        </div>
        {mode === 'sign-in' ? (
          <SignIn
            appearance={{
              elements: {
                card: 'shadow-none border border-slate-200 rounded-xl',
                headerTitle: 'text-xl font-semibold',
                headerSubtitle: 'text-slate-500',
                formButtonPrimary: 'bg-slate-900 hover:bg-slate-800',
              },
            }}
          />
        ) : (
          <SignUp
            appearance={{
              elements: {
                card: 'shadow-none border border-slate-200 rounded-xl',
                headerTitle: 'text-xl font-semibold',
                headerSubtitle: 'text-slate-500',
                formButtonPrimary: 'bg-slate-900 hover:bg-slate-800',
              },
            }}
          />
        )}
      </div>
    </div>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-lg font-bold text-slate-900 tracking-tight">
          FairShare
        </Link>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </nav>
      <main className="max-w-2xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}

function App() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<AuthPage mode="sign-in" />} />
          <Route path="/sign-up" element={<AuthPage mode="sign-up" />} />
          <Route
            path="/"
            element={
              <>
                <SignedIn><Layout><Dashboard /></Layout></SignedIn>
                <SignedOut><Navigate to="/sign-in" /></SignedOut>
              </>
            }
          />
          <Route
            path="/groups/:id"
            element={
              <>
                <SignedIn><Layout><GroupPage /></Layout></SignedIn>
                <SignedOut><Navigate to="/sign-in" /></SignedOut>
              </>
            }
          />
        </Routes>
      </BrowserRouter>
    </ClerkProvider>
  )
}

export default App