// Small authored icon set: 16px grid, 1.6 stroke, round caps.
const wrap = (body: string) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  soundOn: wrap('<path d="M2.5 6v4h2.5l3.5 3V3L5 6z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5"/><path d="M12.8 3.6a6 6 0 0 1 0 8.8"/>'),
  soundOff: wrap('<path d="M2.5 6v4h2.5l3.5 3V3L5 6z"/><path d="M11 6l3.5 4M14.5 6L11 10"/>'),
  chase: wrap('<path d="M2 11.5l4-7h4l4 7z"/><circle cx="8" cy="9.5" r="1.3"/>'),
  heli: wrap('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>'),
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>',
  next: wrap('<path d="M3 8h9"/><path d="M8.5 4.5L12 8l-3.5 3.5"/>'),
  flag: wrap('<path d="M3.5 14V2.5"/><path d="M3.5 3h9l-2 3 2 3h-9"/>'),
  back: wrap('<path d="M13 8H4"/><path d="M7.5 4.5L4 8l3.5 3.5"/>'),
  menu: wrap('<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>'),
  close: wrap('<path d="M4 4l8 8M12 4l-8 8"/>'),
};
