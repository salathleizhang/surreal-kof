import { Player } from '/static/js/player/base.js';
import { GIF } from '/static/js/utils/gif.js';

export class Kyo extends Player {
    constructor(root, info) {
        super(root, info);

        this.init_animations();
    }

    // Initialize the GIFs of the character's seven states in preparation for rendering.
    init_animations() {
        let outer = this;
        let offsets = [0, -22, -22, -140, 0, 0, 0];
        for (let i = 0; i < 7; i++) {

            let gif = GIF();
            gif.load(`/static/images/player/kyo/${i}.gif`);

            // Add the loaded GIF to this map and set some properties.
            this.animations.set(i, {  // The GIF index corresponds to a structure
                gif: gif,
                frame_cnt: 0,  //  A GIF has frame_cnt images
                frame_rate: 5,  // Switch the next image in the GIF every frame_rate frame
                offset_y: offsets[i],  // Add an offset to the action picture in the vertical direction, not needed in the horizontal direction
                loaded: false,  // Has this gif been loaded in. Because there is a loading delay
                scale: 2,  // Enlarge gif images to double
            });

            // When the GIF is available from animations, it is successfully loaded and ready for rendering
            gif.onload = function () {
                let obj = outer.animations.get(i);  // 'outer' stands for 'this' outside of this function
                obj.frame_cnt = gif.frames.length;
                obj.loaded = true;  // If it is loaded, it can be rendered

                // Modify the jumping picture switching frequency individually to make jumping more smooth
                if (i === 3) {
                    obj.frame_rate = 4;
                }
            }
        }
    }
}