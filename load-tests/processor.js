module.exports = {
  $randomString: () => {
    const artists = ['Queen', 'Beatles', 'Pink Floyd', 'Led Zeppelin', 'Rolling Stones'];
    const songs = ['Bohemian Rhapsody', 'Hey Jude', 'Wish You Were Here', 'Stairway to Heaven'];
    
    return Math.random() > 0.5 
      ? artists[Math.floor(Math.random() * artists.length)]
      : songs[Math.floor(Math.random() * songs.length)];
  }
};