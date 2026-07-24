import { NextResponse } from 'next/server';
import axios from 'axios';

// Define the types for Jikan API responses
interface JikanAnime {
  mal_id: number;
  title: string;
  images: {
    jpg: {
      image_url: string;
    };
  };
  episodes: number;
  score: number;
  rank: number;
  type: string;
  source: string;
  rating: string;
}

interface JikanResponse {
  data: JikanAnime[];
}

export async function GET() {
  try {
    const response = await axios.get<JikanResponse>('https://api.jikan.moe/v4/top/anime');
    // Limit to top 10 for the homepage
    const topAnime = response.data.data.slice(0, 10);
    return NextResponse.json({ data: topAnime });
  } catch (error) {
    console.error('Error fetching top anime from Jikan API:', error);
    // Return an error response
    return NextResponse.json({ error: 'Failed to fetch anime data' }, { status: 500 });
  }
}
