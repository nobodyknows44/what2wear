import WeatherDashboard from './components/WeatherDashboard'

export default function Home() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-cover bg-center bg-no-repeat" style={{ backgroundImage: "url('/background.jpg')" }}>
      <div className="absolute inset-0 bg-black opacity-20"></div>
      <div className="relative z-10 w-full h-full flex items-center justify-center">
        <WeatherDashboard />
      </div>
    </div>
  )
}
