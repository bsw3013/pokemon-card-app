import React from 'react';
import { IconAlbum, IconArrowRight } from './icons';
import { countAlbumFilledSlots, countAlbumTotalSlots } from '../../utils/homeStats';

export default function MyAlbumsWidget({ loading, error, recentAlbums, onNavigate }) {
  const newest = recentAlbums?.[0];

  return (
    <section className="home-widget home-widget-albums">
      <header className="home-widget-header">
        <h3><IconAlbum size={18} />내 앨범</h3>
        <button type="button" className="home-widget-link" onClick={() => onNavigate('album')}>
          전체 보기<IconArrowRight size={14} />
        </button>
      </header>

      {loading && (
        <div className="home-skeleton-row">
          <div className="home-skeleton home-skeleton-album-row" />
          <div className="home-skeleton home-skeleton-album-row" />
        </div>
      )}

      {!loading && error && (
        <p className="home-widget-error">불러오지 못했어요. 새로고침해 주세요.</p>
      )}

      {!loading && !error && (!recentAlbums || recentAlbums.length === 0) && (
        <div className="home-widget-empty-block">
          <p className="home-widget-empty">아직 앨범이 없어요</p>
          <button type="button" className="home-widget-link" onClick={() => onNavigate('album')}>
            첫 앨범 만들기<IconArrowRight size={14} />
          </button>
        </div>
      )}

      {!loading && !error && recentAlbums && recentAlbums.length > 0 && (
        <>
          <ul className="home-album-list">
            {recentAlbums.map((album) => {
              const filled = countAlbumFilledSlots(album);
              const total = countAlbumTotalSlots(album);
              const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
              return (
                <li key={album.id} className="home-album-row">
                  <span className="home-album-swatch" style={{ background: album.coverColor || 'var(--border-color)' }} />
                  <div className="home-album-row-body">
                    <strong className="home-album-name">{album.name || '이름 없는 앨범'}</strong>
                    <div className="home-progress-row">
                      <div className="home-progress-bar">
                        <div className="home-progress-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                      </div>
                      <span className="home-progress-label">{filled.toLocaleString()} / {total.toLocaleString()}칸</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {newest && (
            <a href={`#/album?albumId=${newest.id}`} className="home-widget-link home-album-continue">
              {newest.name || '이름 없는 앨범'} 이어서 꾸미기<IconArrowRight size={14} />
            </a>
          )}
        </>
      )}
    </section>
  );
}
