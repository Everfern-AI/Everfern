import React, { useState, useEffect } from 'react';
import SearchBar from '../components/SearchBar';

interface Anime {
  mal_id: number;
  title: string;
  images: {
    jpg: {
      image_url: string;
    };
  };
  score: number;
  rank: number;
}

const HomePage: React.FC = () => {
  const [animeList, setAnimeList] = useState<Anime[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnime = async () => {
      try {
        const response = await fetch('https://api.jikan.moe/v4/top/anime');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setAnimeList(data.data.slice(0, 10)); // Display top 10 anime
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAnime();
  }, []);

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen text-red-500">Error: {error}</div>;
  }

  return (
    <div className="container mx-auto p-4">
      <SearchBar />
      <h1 className="text-4xl font-bold mb-6 text-center">Top Anime</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {animeList.map((anime) => (
          <div key={anime.mal_id} className="bg-white rounded-lg shadow-md overflow-hidden transform transition duration-500 hover:scale-105">
            <img src={anime.images.jpg.image_url} alt={anime.title} className="w-full h-64 object-cover" />
            <div className="p-4">
              <h2 className="text-xl font-semibold mb-2 truncate">{anime.title}</h2>
              <p className="text-gray-600 mb-1">Score: {anime.score}</p>
              <p className="text-gray-600">Rank: {anime.rank}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HomePage;
