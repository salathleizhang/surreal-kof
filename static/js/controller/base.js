export class Controller {
    constructor($canvas) {

        this.$canvas = $canvas;

        this.pressed_keys = new Set();  // Set can de-duplicate and store the current key pressed to avoid continuous triggering.
        this.start();
    }

    start() {
        // Press and add to set, lift and remove from set
        let outer = this;
        this.$canvas.keydown(function (e) {
            outer.pressed_keys.add(e.key);
            // console.log(e.key);
        });

        this.$canvas.keyup(function (e) {
            outer.pressed_keys.delete(e.key);
        });
    }

}