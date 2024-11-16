'use client'

import { useState, useEffect, useRef } from 'react'
import { Cloud, Droplets, Sun, Wind, ArrowLeft, Search, Thermometer, Umbrella } from 'lucide-react'
import type { LocationData, WeatherData, ClothingRecommendation, ClothingItem } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useNotification } from './NotificationContext'

const locationData = {
  'United States': ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'],
  'United Kingdom': ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Glasgow'],
  'Canada': ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa'],
  'Australia': ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'],
  'Japan': ['Tokyo', 'Osaka', 'Kyoto', 'Sapporo', 'Fukuoka'],
  'Germany': ['Berlin', 'Munich', 'Frankfurt', 'Hamburg', 'Cologne'],
  'France': ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice'],
  'Italy': ['Rome', 'Milan', 'Naples', 'Turin', 'Florence'],
  'Brazil': ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza'],
  'India': ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai'],
  'China': ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu'],
  'Russia': ['Moscow', 'Saint Petersburg', 'Novosibirsk', 'Yekaterinburg', 'Kazan'],
  'Mexico': ['Mexico City', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana'],
  'South Africa': ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth'],
  'Spain': ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Zaragoza'],
  'South Korea': ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon'],
  'Argentina': ['Buenos Aires', 'Córdoba', 'Rosario', 'Mendoza', 'La Plata'],
  'Turkey': ['Istanbul', 'Ankara', 'Izmir', 'Bursa', 'Adana'],
  'Saudi Arabia': ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam'],
  'Egypt': ['Cairo', 'Alexandria', 'Giza', 'Shubra El Kheima', 'Port Said'],
  'Nigeria': ['Lagos', 'Abuja', 'Ibadan', 'Kano', 'Port Harcourt'],
  'Indonesia': ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Bekasi'],
  'Malaysia': ['Kuala Lumpur', 'George Town', 'Johor Bahru', 'Ipoh', 'Shah Alam'],
  'Singapore': ['Singapore'],
  'Thailand': ['Bangkok', 'Chiang Mai', 'Pattaya', 'Phuket', 'Hat Yai'],
  'Vietnam': ['Ho Chi Minh City', 'Hanoi', 'Da Nang', 'Haiphong', 'Can Tho'],
  'Philippines': ['Manila', 'Quezon City', 'Cebu City', 'Davao City', 'Zamboanga City'],
  'Pakistan': ['Karachi', 'Lahore', 'Islamabad', 'Faisalabad', 'Rawalpindi'],
  'Bangladesh': ['Dhaka', 'Chittagong', 'Khulna', 'Rajshahi', 'Sylhet'],
  'United Arab Emirates': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain', 'Ajman'],
  'New Zealand': ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Dunedin'],
  'Netherlands': ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'],
  'Sweden': ['Stockholm', 'Gothenburg', 'Malmö', 'Uppsala', 'Västerås'],
  'Norway': ['Oslo', 'Bergen', 'Stavanger', 'Trondheim', 'Drammen'],
  'Finland': ['Helsinki', 'Espoo', 'Tampere', 'Vantaa', 'Oulu'],
  'Denmark': ['Copenhagen', 'Aarhus', 'Odense', 'Aalborg', 'Esbjerg'],
  'Poland': ['Warsaw', 'Kraków', 'Łódź', 'Wrocław', 'Poznań'],
  'Ukraine': ['Kyiv', 'Kharkiv', 'Odessa', 'Dnipro', 'Lviv'],
  'Austria': ['Vienna', 'Graz', 'Linz', 'Salzburg', 'Innsbruck'],
  'Switzerland': ['Zurich', 'Geneva', 'Basel', 'Lausanne', 'Bern'],
  'Belgium': ['Brussels', 'Antwerp', 'Ghent', 'Charleroi', 'Liège'],
  'Portugal': ['Lisbon', 'Porto', 'Amadora', 'Braga', 'Coimbra'],
  'Greece': ['Athens', 'Thessaloniki', 'Patras', 'Heraklion', 'Larissa'],
  'Romania': ['Bucharest', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Constanța'],
  'Hungary': ['Budapest', 'Debrecen', 'Szeged', 'Miskolc', 'Pécs'],
  'Czech Republic': ['Prague', 'Brno', 'Ostrava', 'Plzeň', 'Liberec'],
  'Ireland': ['Dublin', 'Cork', 'Limerick', 'Galway', 'Waterford'],
  'Israel': ['Tel Aviv', 'Jerusalem', 'Haifa', 'Rishon LeZion', 'Petah Tikva'],
  'Chile': ['Santiago', 'Valparaíso', 'Concepción', 'La Serena', 'Antofagasta'],
  'Colombia': ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena'],
  'Peru': ['Lima', 'Arequipa', 'Trujillo', 'Chiclayo', 'Piura'],
  'Venezuela': ['Caracas', 'Maracaibo', 'Valencia', 'Barquisimeto', 'Ciudad Guayana'],
  'Kazakhstan': ['Almaty', 'Nur-Sultan', 'Shymkent', 'Karaganda', 'Aktobe'],
  'Uzbekistan': ['Tashkent', 'Samarkand', 'Bukhara', 'Andijan', 'Namangan'],
  'Morocco': ['Casablanca', 'Rabat', 'Fes', 'Marrakech', 'Tangier'],
  'Kenya': ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret'],
  'Ethiopia': ['Addis Ababa', 'Dire Dawa', 'Mekelle', 'Gondar', 'Awasa'],
  'Ghana': ['Accra', 'Kumasi', 'Sekondi-Takoradi', 'Tamale', 'Sunyani']
}

interface WeatherDashboardProps {
  showRecommendations: boolean;
  setShowRecommendations: (show: boolean) => void;
}

export default function WeatherDashboard({ showRecommendations, setShowRecommendations }: WeatherDashboardProps) {
  const [location, setLocation] = useState<LocationData>({
    city: '',
    country: ''
  })
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [recommendations, setRecommendations] = useState<ClothingRecommendation | null>(null)
  const [loading, setLoading] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [citySearch, setCitySearch] = useState('')
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const [showCityDropdown, setShowCityDropdown] = useState(false)
  const { showNotification } = useNotification()

  const countryRef = useRef<HTMLDivElement>(null)
  const cityRef = useRef<HTMLDivElement>(null)

  const filteredCountries = Object.keys(locationData).filter(country =>
    country.toLowerCase().includes(countrySearch.toLowerCase())
  )

  const filteredCities = location.country
    ? locationData[location.country as keyof typeof locationData].filter(city =>
        city.toLowerCase().includes(citySearch.toLowerCase())
      )
    : []

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (countryRef.current && !countryRef.current.contains(event.target as Node)) {
        setShowCountryDropdown(false)
      }
      if (cityRef.current && !cityRef.current.contains(event.target as Node)) {
        setShowCityDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch(
        `/api/weather?city=${encodeURIComponent(location.city)}&country=${encodeURIComponent(location.country)}`
      )
      
      if (!response.ok) {
        throw new Error('Failed to fetch weather data')
      }

      const data = await response.json()
      setWeather(data.weather)
      setRecommendations(data.recommendations)
      setShowRecommendations(true)
      showNotification('Recommendations fetched successfully', 'success')
    } catch (err) {
      console.error('Error in handleSubmit:', err)
      showNotification('Error fetching recommendations. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const getWindDescription = (speed: number) => {
    if (speed < 1) return 'Calm'
    if (speed < 5) return 'Light breeze'
    if (speed < 11) return 'Moderate breeze'
    if (speed < 19) return 'Strong breeze'
    return 'High wind'
  }

  const getWeatherIcon = (conditions: string) => {
    const lowerConditions = conditions.toLowerCase()
    if (lowerConditions.includes('rain') || lowerConditions.includes('drizzle')) return <Umbrella className="h-6 w-6 text-blue-500" />
    if (lowerConditions.includes('cloud')) return <Cloud className="h-6 w-6 text-gray-500" />
    if (lowerConditions.includes('clear') || lowerConditions.includes('sun')) return <Sun className="h-6 w-6 text-yellow-500" />
    return <Cloud className="h-6 w-6 text-gray-500" />
  }

  return (
    <section className="w-full min-h-screen overflow-y-auto pb-20">
      <Card className={`w-[90%] max-w-3xl mx-auto my-4 backdrop-blur-sm bg-white/90 border border-white/50 shadow-lg rounded-3xl ${!showRecommendations ? 'max-w-md' : ''}`}>
        {!showRecommendations ? (
          <CardContent className="my-8 px-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2" ref={countryRef}>
                <label htmlFor="country" className="text-sm font-semibold text-gray-700/90">
                  Your Country
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-5 w-5 text-purple-400" />
                  <Input
                    id="country"
                    placeholder="Search for a country"
                    value={countrySearch}
                    onChange={(e) => {
                      setCountrySearch(e.target.value)
                      setShowCountryDropdown(true)
                    }}
                    onFocus={() => setShowCountryDropdown(true)}
                    className="pl-10 h-12 bg-white/50 border-purple-100 focus:border-purple-300 rounded-xl"
                  />
                </div>
                {showCountryDropdown && (
                  <div className="mt-1 max-h-40 overflow-auto absolute z-10 w-full md:w-[400px] bg-white border border-gray-300 rounded-md shadow-lg">
                    {filteredCountries.map((country) => (
                      <button
                        key={country}
                        type="button"
                        onClick={() => {
                          setLocation(prev => ({ ...prev, country }))
                          setCountrySearch(country)
                          setShowCountryDropdown(false)
                          setCitySearch('')
                        }}
                        className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                      >
                        {country}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2" ref={cityRef}>
                <label htmlFor="city" className="text-sm font-semibold text-gray-700/90">
                  Your City
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-5 w-5 text-purple-400" />
                  <Input
                    id="city"
                    placeholder="Search for a city"
                    value={citySearch}
                    onChange={(e) => {
                      setCitySearch(e.target.value)
                      setShowCityDropdown(true)
                    }}
                    onFocus={() => setShowCityDropdown(true)}
                    className="pl-10 h-12 bg-white/50 border-purple-100 focus:border-purple-300 rounded-xl"
                    disabled={!location.country}
                  />
                </div>
                {showCityDropdown && location.country && (
                  <div className="mt-1 max-h-40 overflow-auto absolute z-10 w-full md:w-[400px] bg-white border border-gray-300 rounded-md shadow-lg">
                    {filteredCities.map((city) => (
                      <button
                        key={city}
                        type="button"
                        onClick={() => {
                          setLocation(prev => ({ ...prev, city }))
                          setCitySearch(city)
                          setShowCityDropdown(false)
                        }}
                        className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl font-semibold shadow-lg transition-all duration-300"
                disabled={loading || !location.city || !location.country}
              >
                {loading ? 
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Crafting your style...</span>
                  </div>
                  : 
                  'Get Your Fashion Forecast ✨'
                }
              </Button>
            </form>
          </CardContent>
        ) : (
          <CardContent className="p-4 md:p-8 overflow-y-auto">
            {weather && recommendations && (
              <div className="space-y-6 md:space-y-8">
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-bold text-purple-600">
                    Fashion Forecast
                  </h2>
                  <p className="text-gray-600 text-lg">
                    {location.city}, {location.country}
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                  {[
                    { 
                      icon: <Thermometer className="h-8 w-8 md:h-10 md:w-10 text-pink-500" />, 
                      value: `${weather.temperature}°C`, 
                      label: "Temperature" 
                    },
                    { 
                      icon: <Cloud className="h-8 w-8 md:h-10 md:w-10 text-gray-500" />, 
                      value: weather.conditions, 
                      label: "Conditions" 
                    },
                    { 
                      icon: <Wind className="h-8 w-8 md:h-10 md:w-10 text-blue-500" />, 
                      value: getWindDescription(weather.windSpeed), 
                      label: "Wind" 
                    },
                    { 
                      icon: <Droplets className="h-6 w-6 md:h-8 md:w-8 text-blue-400" />, 
                      value: `${weather.humidity}%`, 
                      label: "Humidity" 
                    }
                  ].map((item, index) => (
                    <div 
                      key={index} 
                      className="bg-white rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col items-center text-center shadow-sm h-full"
                    >
                      <div className="flex flex-col items-center pt-1 md:pt-2">
                        <div className="flex justify-center">
                          {item.icon}
                        </div>
                        <span className="text-lg md:text-xl text-gray-800 mt-1 md:mt-2 mb-1">
                          {item.value}
                        </span>
                        <span className="text-xs md:text-sm text-gray-500">
                          {item.label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-xl p-4">
                  <h3 className="text-2xl font-bold text-purple-600 text-center mb-2">
                    Your AI-Curated Outfit
                  </h3>
                  <p className="text-gray-700 italic text-center text-base mb-6">
                    {recommendations.description}
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
                    <div>
                      <h4 className="text-sm md:text-base font-bold text-purple-600 mb-2 md:mb-3">
                        👚 Top Trends
                      </h4>
                      {recommendations.topWear?.map((item: ClothingItem, index: number) => (
                        <p key={index} className="text-sm md:text-base mb-1 md:mb-2">
                          {item.item} <span className="text-purple-500">in {item.color}</span>
                        </p>
                      ))}
                    </div>

                    <div>
                      <h4 className="text-sm md:text-base font-bold text-blue-600 mb-2 md:mb-3 mt-4 md:mt-0">
                        👖 Bottom Beats
                      </h4>
                      {recommendations.bottomWear?.map((item: ClothingItem, index: number) => (
                        <p key={index} className="text-sm md:text-base mb-1 md:mb-2">
                          {item.item} <span className="text-blue-500">in {item.color}</span>
                        </p>
                      ))}
                    </div>

                    <div>
                      <h4 className="text-sm md:text-base font-bold text-green-600 mb-2 md:mb-3 mt-4 md:mt-0">
                        🎩 Accessory Accents
                      </h4>
                      {recommendations.accessories?.map((item: ClothingItem, index: number) => (
                        <p key={index} className="text-sm md:text-base mb-1 md:mb-2">
                          {item.item} <span className="text-green-500">in {item.color}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex justify-center mt-6 md:mt-8 pb-4">
              <Button
                variant="outline"
                className="w-full md:w-[400px] h-10 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl font-semibold shadow-lg transition-all duration-300"
                onClick={() => setShowRecommendations(false)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Fashion Machine
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </section>
  )
}
