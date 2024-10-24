'use client'

import { useState, useEffect, useRef } from 'react'
import { Cloud, Droplets, Sun, Wind, ArrowLeft, Search } from 'lucide-react'
import type { LocationData, WeatherData, ClothingRecommendation } from '@/types'
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

export default function WeatherDashboard() {
  const [location, setLocation] = useState<LocationData>({
    city: '',
    country: ''
  })
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [recommendations, setRecommendations] = useState<ClothingRecommendation | null>(null)
  const [recommendationSource, setRecommendationSource] = useState<'AI' | 'Fallback' | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRecommendations, setShowRecommendations] = useState(false)
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
      setRecommendationSource(data.source)
      setShowRecommendations(true)
      showNotification(`Recommendations fetched successfully (${data.source})`, 'success')
    } catch (err) {
      console.error(err); // Log the error for debugging
      showNotification('Error fetching recommendations. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center">What2Wear</CardTitle>
          <CardDescription className="text-xl text-center">Real-time weather, real-time style</CardDescription>
        </CardHeader>
        {!showRecommendations ? (
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2" ref={countryRef}>
                <label htmlFor="country" className="text-sm font-medium text-gray-700">
                  Country
                </label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="country"
                    placeholder="Search for a country"
                    value={countrySearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setCountrySearch(e.target.value)
                      setShowCountryDropdown(true)
                    }}
                    onFocus={() => setShowCountryDropdown(true)}
                    className="pl-8"
                  />
                </div>
                {showCountryDropdown && (
                  <div className="mt-1 max-h-40 overflow-auto absolute z-10 w-[400px] bg-white border border-gray-300 rounded-md shadow-lg">
                    {filteredCountries.map((country) => (
                      <button
                        key={country}
                        type="button"
                        onClick={() => {
                          setLocation(prev => ({ ...prev, country }))
                          setCountrySearch(country)
                          setShowCountryDropdown(false)
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
                <label htmlFor="city" className="text-sm font-medium text-gray-700">
                  City
                </label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="city"
                    placeholder="Search for a city"
                    value={citySearch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setCitySearch(e.target.value)
                      setShowCityDropdown(true)
                    }}
                    onFocus={() => setShowCityDropdown(true)}
                    className="pl-8"
                  />
                </div>
                {showCityDropdown && (
                  <div className="mt-1 max-h-40 overflow-auto absolute z-10 w-[400px] bg-white border border-gray-300 rounded-md shadow-lg">
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
              <Button type="submit" className="w-full" disabled={loading || !location.city || !location.country}>
                {loading ? 'Loading...' : 'Get Recommendations'}
              </Button>
            </form>
          </CardContent>
        ) : (
          <CardContent>
            {weather && recommendations && (
              <div>
                <h2 className="text-xl font-semibold mb-4">Recommendations for {location.city}, {location.country}</h2>
                <p className="text-sm text-gray-500 mb-4">
                  Source: {recommendationSource === 'AI' ? 'AI-powered' : 'Standard algorithm'}
                </p>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="flex items-center space-x-2">
                    <Sun className="h-5 w-5 text-yellow-500" />
                    <span>{weather.temperature}°C</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Cloud className="h-5 w-5 text-gray-500" />
                    <span>{weather.conditions}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Wind className="h-5 w-5 text-blue-500" />
                    <span>{weather.windSpeed} m/s</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Droplets className="h-5 w-5 text-blue-300" />
                    <span>{weather.humidity}%</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Suggested Outfit</h3>
                  <p className="text-gray-700 italic">{recommendations.description}</p>
                  
                  {recommendations.topWear.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-800">Top:</h4>
                      <p className="text-gray-700">{recommendations.topWear.join(', ')}</p>
                    </div>
                  )}
                  
                  {recommendations.bottomWear.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-800">Bottom:</h4>
                      <p className="text-gray-700">{recommendations.bottomWear.join(', ')}</p>
                    </div>
                  )}
                  
                  {recommendations.accessories.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-800">Accessories:</h4>
                      <p className="text-gray-700">{recommendations.accessories.join(', ')}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setShowRecommendations(false)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Selection
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
