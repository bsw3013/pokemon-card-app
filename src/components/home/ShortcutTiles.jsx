import React from 'react';

// 바로가기 타일 한 줄. items: [{ id, label, Icon }]
export default function ShortcutTiles({ items, onNavigate }) {
  return (
    <nav className="home-shortcut-grid" aria-label="바로가기">
      {items.map((item) => {
        const Icon = item.Icon;
        return (
          <button key={item.id} type="button" className="home-shortcut-tile" onClick={() => onNavigate(item.id)}>
            <Icon size={22} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
