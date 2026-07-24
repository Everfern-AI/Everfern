import { NextResponse } from 'next/server';
import axios from 'axios';

interface JikanAnime {
  mal_id: number;
  title: string;
  images: {
    jpg: {
      image_url: string;
    };
  };
  score: number;
  rank: number;
  type: string;
  source: string;
  rating: string;
}

interface JikanResponse {
  data: JikanAnime[];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
  }

  try {
    // Using v4 of the Jikan API search endpoint
    const response = await axios.get<any>(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=10`);
    // The structure might differ slightly for search results, adjust as needed
    // Assuming response.data.data contains the array of anime
    const searchResults: JikanAnime[] = response.data.data.map((anime: any) => ({
      mal_id: anime.mal_id,
      title: anime.title,
      images: anime.images,
      score: anime.score,
      rank: anime.rank,
      type: anime.type,
      source: anime.source,
      rating: anime.rating,
    }));
    return NextResponse.json({ data: searchResults });
  } catch (error) {
    console.error(`Error fetching search results for query "${query}":`, error);
    return NextResponse.json({ error: 'Failed to fetch search results' }, { status: 500 });
  }
}
