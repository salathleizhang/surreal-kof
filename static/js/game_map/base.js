import { AcGameObject } from '/static/js/ac_game_object/base.js';
import { Controller } from '/static/js/controller/base.js';

export class GameMap extends AcGameObject {
    constructor(root) {
        super();

        this.root = root;
        // create a jQuery object $canvas
        this.$canvas = $('<canvas width="1280" height="720" tabindex=0></canvas>');  // tabindex=0 allows canvas focus
        this.ctx = this.$canvas[0].getContext('2d');

        // Add $canvas to the end of $kof(<div id="kof"></div>)
        this.root.$kof.append(this.$canvas);
        this.$canvas.focus();  // Focus to get keyboard input
        this.controller = new Controller(this.$canvas);  // get keyboard input

        // countdown and HP bars, internal div for blood loss fade effect
        this.root.$kof.append($(`<div class="kof-head">
            <div class="kof-head-hp-0"><div><div></div></div></div>
            <div class="kof-head-timer">60</div>
            <div class="kof-head-hp-1"><div><div></div></div></div>
        </div>`));

        // countdown time
        this.time_left = 60000;
        this.$timer = this.root.$kof.find(".kof-head-timer");
    }

    start() {

    }

    update() {
        this.time_left -= this.timedelta;
        if (this.time_left < 0) {
            this.time_left = 0;

            // Countdown ends if no player is defeated then both lose
            let [a, b] = this.root.players;
            if (a.status !== 6 && b.status !== 6) {
                a.status = b.status = 6;
                a.frame_current_cnt = b.frame_current_cnt = 0;  // Render the fall animation from frame 0
                a.vx = b.vx = 0;  // fix bug: Character continues to slide after hitting the ground
            }
        }

        // Render the remaining time into the timer
        this.$timer.text(parseInt(this.time_left / 1000));

        this.render();
    }

    render() {
        // Clear the map once per frame to eliminate object movement traces
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height)

        // this.ctx.fillStyle = 'black';
        // this.ctx.fillRect(0, 0, this.$canvas.width(), this.$canvas.height());
    }
}