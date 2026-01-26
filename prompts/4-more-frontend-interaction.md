Now we're going to implement some more frontend interaction features regarding flight strips, bays and sections:
- The default behavior when dragging a strip to a section should be as it is now - auto-sort from the top.
- The user should be able to create a gap between strips, by dragging a strip within the same section, but not far enough that it passes half of another strip (which changes the sorting order).
- The user should be able to attach strips to the bottom of the section instead, by dragging it to a small (say 10px tall) drop area at the bottom of the section. More than one strip can be placed at the bottom, and they can be resorted etc, so essentially bottom and top of sections follow the same principles but the top section is default, and attaching to bottom only happens when the user specifically drags a strip to that small drop area at the bottom.
- When overflowing, strips attached to bottom have priority (there should mostly be just 1 or 2 strips attached to bottom), so that the overflow and scrolling is for the top-attached strips only. When a section is overflowing, the scrollbar should always be visible (regardless of touch device or not) and not change width, so a mac/ios-style scrollbar (but always visible).
- Sections can be resized by dragging the section header up and down.

...

I notice two errors:   
1) when dragging a section header, it moves in reverse, e.g. if I drag up, it moves down. 2) creating gaps only works by dragging upwards, and then it creates a gap moving the strip     
  downwards - feels backwards. there's no way to reduce the grap by dragging back up. feels like it should be the other way around - create a gap by dragging a strip downwards, reduce     
  the gap by dragging it back up.  

...

creating gaps doesn't work at all now. If I drag downwards the bottom-most strip just returns. If there's a strip below, it changes sort order even if I drag just a few pixels.          
  Dragging upwards works as expected, changing sort order if I pass half of the strip above. Let's rework it so that creating gaps only works by dragging downwards. If there are strips    
  below they should "follow". Dragging back upwards reduces the gap. E.g. gaps only exist above strips (for those attached to top - reversed for those attached to bottom).  

...

Works much better. However, there seems to be a bit of a "scaling factor". Moving a strip downwards by 50px creates about a 10px gap. I would like it to be 1:1. And let's add another feature. Clicking in a gap removes the gap.                                                                                                                            

...

Let's make the strips horizontally scrollable. The left-most section (.strip-left) should always be visible. Add a right-most section (.strip-right) which just contains a button that,   
  when clicked, performs the default action (same as clicking the strip indicator now - in fact let's change it so it's just clicking the button that performs the defualt action). The     
  middle part between the left and right sections should be horizontally scrollable, and it should work in touch by dragging horizontally.

...

Make it work the same way in non-touch - dragging horizontally in the middle area scrolls, dragging vertically to start drag-and-drop should still work.

...

Slut på tokens.
Börjar ana att vi målat in oss i ett AI-hörn..

Funkar fortfarande inte:
- non-touch mode: horizontal scroll by drag
- touch-mode: byta sorteringsordning genom att dra nedåt (skapar hela tiden gap)
