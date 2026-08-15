import Viewer from './Viewer'
import Host from './Host'
import PcController from './PcController'

// Tiny path-based router (no router dependency):
//   /host -> browser screenshare host
//   /pc   -> local avfoundation device picker
//   /     -> auto-playing viewer
function App() {
  const path = window.location.pathname
  if (path === '/host') return <Host />
  if (path === '/pc') return <PcController />
  return <Viewer />
}

export default App
