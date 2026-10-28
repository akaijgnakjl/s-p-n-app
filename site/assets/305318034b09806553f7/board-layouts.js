/** Text regions copied from the reference HTML; percentages of the original board image. */
const box = (x, y, w, h, font, align = 'left', wrap = false) => Object.freeze({ x, y, w, h, font, align, wrap });
export const BOARD_OVERLAYS = Object.freeze({
  'sample-2111': Object.freeze({
    fields: Object.freeze({ job: box(20.4, 1.9, 77.4, 14.7, 7.5), route: box(20.4, 17.1, 77.4, 12.0, 7.5) }),
    stack: Object.freeze({ keys: Object.freeze(['note', 'point']), ...box(3.0, 29.8, 94.0, 68.2, 7.2, 'center', true) })
  }),
  'sample-2112': Object.freeze({
    fields: Object.freeze({
      job: box(20.4, 1.9, 77.4, 14.7, 7.5),
      workType: box(20.3, 17.7, 30.4, 13.0, 6.4, 'center'),
      date: box(20.3, 30.8, 30.4, 13.0, 6.0, 'center'),
      location: box(20.3, 44.1, 30.4, 13.0, 6.4, 'center'),
      designSize: box(20.3, 57.3, 30.4, 13.0, 6.4, 'center'),
      actualSize: box(20.3, 70.6, 30.4, 13.0, 6.4, 'center'),
      attendee: box(20.3, 83.9, 30.4, 13.0, 6.4, 'center'),
      remarks: box(51.7, 28.5, 46.0, 68.0, 5.8, 'left', true)
    })
  }),
  'sample-2113': Object.freeze({
    fields: Object.freeze({
      job: box(20.4, 1.9, 77.4, 14.7, 7.5),
      location: box(20.4, 17.1, 77.4, 11.4, 7.5),
      note: box(3.0, 30.0, 94.0, 36.0, 6.8, 'left', true),
      date: box(30.0, 73.1, 68.0, 14.2, 7.4, 'right'),
      contractor: box(20.4, 89.1, 77.4, 9.5, 6.2)
    })
  }),
  'sample-2114': Object.freeze({
    fields: Object.freeze({ job: box(20.4, 1.9, 77.4, 14.7, 7.5) }),
    stack: Object.freeze({ keys: Object.freeze(['note']), ...box(3.0, 17.0, 94.0, 81.0, 7.2, 'left', true) })
  }),
  'sample-2115': Object.freeze({
    fields: Object.freeze({ job: box(20.4, 1.9, 77.4, 14.7, 7.5), route: box(20.4, 17.1, 77.4, 12.0, 7.5), contractor: box(49.0, 85.0, 25.0, 12.0, 5.2, 'right') }),
    stack: Object.freeze({ keys: Object.freeze(['note', 'point']), ...box(3.0, 30.0, 94.0, 51.0, 7.2, 'center', true) })
  })
});

