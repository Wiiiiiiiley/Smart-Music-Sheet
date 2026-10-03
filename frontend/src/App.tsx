import { Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './stores/appStore'
import LandingPage from './pages/LandingPage'
import RoleSelectPage from './pages/RoleSelectPage'
import ConductorPage from './pages/ConductorPage'
import PlayerPage from './pages/PlayerPage'
import EnsembleSetupPage from './pages/EnsembleSetupPage'
import ScoreUploadPage from './pages/ScoreUploadPage'
import { lazy, Suspense } from 'react'
import RehearsalReviewPage from './pages/RehearsalReviewPage'

const NotationPage = lazy(() => import('./pages/NotationPage'))

function App() {
  const { currentUser, currentEnsemble } = useAppStore()

  return (
    <div className="h-full w-full bg-gray-50">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/role-select" element={<RoleSelectPage />} />
        <Route path="/setup" element={currentUser?.role === 'CONDUCTOR' ? <EnsembleSetupPage /> : <Navigate to="/role-select" replace />} />
        <Route path="/upload" element={currentUser?.role === 'CONDUCTOR' ? <ScoreUploadPage /> : <Navigate to="/role-select" replace />} />
        <Route path="/notation" element={currentUser?.role === 'CONDUCTOR' ? <Suspense fallback={<div className="p-8">正在打开打谱工作台…</div>}><NotationPage /></Suspense> : <Navigate to="/role-select" replace />} />
        <Route path="/notation/:scoreId" element={currentUser?.role === 'CONDUCTOR' ? <Suspense fallback={<div className="p-8">正在打开打谱工作台…</div>}><NotationPage /></Suspense> : <Navigate to="/role-select" replace />} />
        <Route path="/review" element={currentUser && currentEnsemble ? <RehearsalReviewPage /> : <Navigate to="/role-select" replace />} />
        <Route 
          path="/conductor" 
          element={currentUser?.role === 'CONDUCTOR' ? <ConductorPage /> : <Navigate to="/role-select" />} 
        />
        <Route path="/conductor/score/:scoreId" element={currentUser?.role === 'CONDUCTOR' ? <ConductorPage /> : <Navigate to="/role-select" replace />} />
        <Route path="/player/join" element={currentUser?.role === 'PLAYER' ? <PlayerPage /> : <Navigate to="/role-select" replace />} />
        <Route 
          path="/player/:ensembleId" 
          element={currentUser?.role === 'PLAYER' ? <PlayerPage /> : <Navigate to="/role-select" />} 
        />
        <Route path="/player" element={currentUser?.role === 'PLAYER' ? <PlayerPage /> : <Navigate to="/role-select" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default App
