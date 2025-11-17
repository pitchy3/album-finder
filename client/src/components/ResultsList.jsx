// client/src/components/ResultsList.jsx

import AlbumCard from './AlbumCard.jsx';
import { usePreferences } from "../contexts/PreferencesContext.jsx";

export default function ResultsList({ results, onAddToLidarr }) {
  const { preferences } = usePreferences();

  if (results.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className={`text-2xl font-bold mb-4 ${preferences.darkMode ? 'text-white' : 'text-gray-800'}`}>
        Top {results.length} Release{results.length > 1 ? 's' : ''} Found
      </h2>
      
      {results.map((album, index) => (
        <AlbumCard
          key={album.mbid}
          album={album}
          index={index}
          onAddToLidarr={onAddToLidarr}
		  artistInLidarr={false}
        />
      ))}
    </div>
  );
}