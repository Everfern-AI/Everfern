import React, { useState } from 'react';
import { useRouter } from 'next/router';

const SearchBar: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      router.push(`/search?q=${searchTerm}`);
    }
  };

  return (
    <form onSubmit={handleSearch} className="flex items-center max-w-lg mx-auto mb-8">
      <input
        type="text"
        placeholder="Search for anime..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full p-3 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        className="p-3 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Search
      </button>
    </form>
  );
};

export default SearchBar;
