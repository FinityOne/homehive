export type Home = {
  slug: string
  name: string
  address: string
  price: number
  beds: number
  baths: number
  sqft: string
  available: number
  totalRooms: number
  asuDistance: string
  asuScore: number
  asuScoreReasons: string[]
  tags: string[]
  heroImage: string
  images: string[]
  mapEmbedUrl: string
  description: string
  coordinates: [number, number]
  nearbyPlaces: { place: string; time: string }[]
}

export const homes: Home[] = [
  {
    slug: 'palace-jacuzzi',
    name: 'University Dr Palace w/ Jacuzzi',
    address: '820 W 9th Street, Tempe, AZ 85281',
    price: 699,
    beds: 6,
    baths: 4,
    sqft: '2,000',
    available: 6,
    totalRooms: 6,
    asuDistance: '0.2',
    asuScore: 9.7,
    asuScoreReasons: [
      '5 min walk to ASU main campus',
      '3 min walk to light rail',
      'Mill Ave dining right outside',
      'Bike lane directly to campus',
    ],
    tags: ['Jacuzzi', 'WiFi included', 'Washer/dryer', 'A/C & heat', 'Parking', 'Pet friendly'],
    heroImage: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=85',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80',
      'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
      'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800&q=80',
    ],
    mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3330.087665275874!2d-111.95342332392204!3d33.420958750799386!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x872b08d4dd983c7b%3A0x910d40bee5b2f2b!2s820%20W%209th%20St%2C%20Tempe%2C%20AZ%2085281!5e0!3m2!1sen!2sus!4v1774039211364!5m2!1sen!2sus',
    description: 'A fully-equipped 6-bedroom home one block from Mill Ave. Jacuzzi, no broker fees, flexible move-in around the ASU academic calendar.',
    coordinates: [33.4210, -111.9534],
    nearbyPlaces: [
      { place: 'ASU Main Campus', time: '5 min walk' },
      { place: 'Mill Ave Dining', time: '3 min walk' },
      { place: 'Light Rail Stop', time: '3 min walk' },
      { place: 'Target / Groceries', time: '8 min bike' },
    ],
  },
  {
    slug: 'delrio-house',
    name: 'ASU Student Castle',
    address: '110 W Del Rio Dr, Tempe, AZ 85282',
    price: 599,
    beds: 5,
    baths: 2,
    sqft: '2,500',
    available: 5,
    totalRooms: 5,
    asuDistance: '1.1',
    asuScore: 8.7,
    asuScoreReasons: [
      '10 min walk to ASU campus',
      'On the 72 bus route',
      'Close to Frys and Walmart',
      'Large private backyard',
    ],
    tags: ['WiFi included', 'Backyard', 'A/C & heat', 'Pet friendly'],
    heroImage: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=85',
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&q=80',
    ],
    mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3330.9451697281715!2d-111.94406582392284!3d33.398594651961275!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x872b08b0b72c8281%3A0x1b70458cc1e96761!2s110%20W%20Del%20Rio%20Dr%2C%20Tempe%2C%20AZ%2085282!5e0!3m2!1sen!2sus!4v1774036415941!5m2!1sen!2sus',
    description: 'A cozy 5-bedroom on Del Rio with a large private backyard. Great for students who want space without breaking the budget.',
    coordinates: [33.3986, -111.9441],
    nearbyPlaces: [
      { place: 'ASU Campus', time: '10 min walk' },
      { place: '72 Bus Stop', time: '2 min walk' },
      { place: "Fry's Grocery", time: '5 min walk' },
      { place: 'Walmart', time: '7 min walk' },
    ],
  },
]
