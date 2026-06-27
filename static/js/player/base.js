import { AcGameObject } from '/static/js/ac_game_object/base.js';

export class Player extends AcGameObject {
    constructor(root, info) {  // root is the base class's object
        super();

        this.root = root;
        // character's info
        this.id = info.id;
        this.x = info.x;  // Start coordinates
        this.y = info.y;
        this.width = info.width;  // Hitboxes
        this.height = info.height;
        this.color = info.color;

        this.direction = 1;  // Character positive direction is 1; opposite direction is -1

        // Current velocity in horizontal and vertical directions
        this.vx = 0;
        this.vy = 0;

        // Initial velocity (px/s) in horizontal and vertical directions when jumping up
        this.speedx = 400;
        this.speedy = -1000;  // Jumping upward, so the velocity direction is negative

        // Gravity acceleration
        this.gravity = 50;

        this.ctx = this.root.game_map.ctx;
        this.pressed_keys = this.root.game_map.controller.pressed_keys;

        // Limited state machine: the character has seven states. 
        // 0: idle, 1: forward, 2: backward, 3: jump, 4: attack, 5: be hit, 6: death
        this.status = 3; // The character is falling from the top, so the initial state is jumping

        this.animations = new Map();  // save state string

        this.frame_current_cnt = 0;  // It's now frame 0

        this.hp = 100;
        // Find HP bar div of the character
        // find class + .; String with expressions `string${exp}`
        // $(selector).find(filter)：Find in all descendant elements
        this.$hp = this.root.$kof.find(`.kof-head-hp-${this.id}>div`);  // outer，red
        this.$hp_div = this.$hp.find('div');  // inner, green
    }

    start() {

    }

    update_move() {
        this.vy += this.gravity;

        // Current character coordinates
        this.x += this.vx * this.timedelta / 1000;
        this.y += this.vy * this.timedelta / 1000;

        let [a, b] = this.root.players;

        // a push b
        if (a !== this) [a, b] = [b, a];

        // x1y1 indicates the top left corner of the Hitbox, x2y2 indicates the bottom right corner
        let r1 = {
            x1: a.x,
            y1: a.y,
            x2: a.x + a.width,
            y2: a.y + a.height,
        };
        let r2 = {
            x1: b.x,
            y1: b.y,
            x2: b.x + b.width,
            y2: b.y + b.height,
        };

        if (this.is_collision(r1, r2) && b.status !== 6) {  // No push effect when the opponent is dead
            // Realize the pushing effect after collision occurs. Update the character coordinates.
            // a push b
            b.x += this.vx * this.timedelta / 1000 / 2;
            b.y += this.vy * this.timedelta / 1000 / 2;
            a.x -= this.vx * this.timedelta / 1000 / 2;
            a.y -= this.vy * this.timedelta / 1000 / 2;

            // If a collision occurs, the jump state becomes stationary. 
            // Avoid continuing to jump after jumping on the opponent because it cannot drop to the ground.
            if (this.status === 3)
                this.status = 0;
        }

        // If not at ground level
        if (this.y > 450) {  // Stop on the ground after jumping down
            this.y = 450;
            this.vy = 0;

            // Only in the jump state, after landing becomes idle, 
            // being attacked and death state needs to continue to play animation after landing
            if (this.status === 3)
                this.status = 0;
        }

        // Ensure that the character is inside the canvas
        if (this.x < 0) {
            this.x = 0;
        } else if (this.x + this.width > this.root.game_map.$canvas.width()) {
            this.x = this.root.game_map.$canvas.width() - this.width;
        }
    }

    update_control() {
        let w, a, d, space;
        if (this.id === 0) {
            w = this.pressed_keys.has('w');
            a = this.pressed_keys.has('a');
            d = this.pressed_keys.has('d');
            space = this.pressed_keys.has(' ');
        } else {
            w = this.pressed_keys.has('ArrowUp');
            a = this.pressed_keys.has('ArrowLeft');
            d = this.pressed_keys.has('ArrowRight');
            space = this.pressed_keys.has('Enter');
        }

        // console.log(this.pressed_keys);

        // Finite state machines: state transitions
        if (this.status === 0 || this.status === 1) { // idle or move
            if (space) {  // attack
                this.status = 4;
                this.xv = 0;
                this.frame_current_cnt = 0;
            } else if (w) {  // jump
                if (d) {  // Jumping forward at a 45 degree angle
                    this.vx = this.speedx;
                } else if (a) {
                    this.vx = -this.speedx;
                } else {
                    this.vx = 0;
                }
                this.vy = this.speedy;
                this.status = 3;
                this.frame_current_cnt = 0;
            } else if (d) {  // forward
                this.vx = this.speedx;
                this.status = 1;
            } else if (a) {  // backward
                this.vx = -this.speedx;
                this.status = 1;  // backward status is also 1
            } else {  // no input
                this.vx = 0;
                this.status = 0;
            }
        }
        // console.log(this.vx, this.vy);
    }

    // Keeping the two players face-to-face
    update_direction() {
        if (this.status === 6) return;  // If the character is already dead, there is no need to swap directions

        let players = this.root.players;
        if (players[0] && players[1]) {
            let me = this, you = players[1 - this.id];  // my id = 0, your id = 1; my id = 1, your id = 0
            if (me.x < you.x) me.direction = 1;  // If my coordinates are to the left of my opponent's, I face right
            else me.direction = -1;
        }
    }

    is_attack() {  // be hit
        if (this.status === 6) return;

        this.status = 5;
        this.frame_current_cnt = 0;

        // Get hit once and reduce 20 HP until 0.
        this.hp = Math.max(this.hp - 20, 0);

        // Blood loss includes two animation effects
        // (selector).animate({styles},speed,easing,callback)
        this.$hp_div.animate({  // inner, fast
            width: this.$hp.parent().width() * this.hp / 100,
        }, 300);
        this.$hp.animate({  // outer, slow
            width: this.$hp.parent().width() * this.hp / 100,
        }, 600);

        if (this.hp <= 0) {  // died
            this.status = 6;
            this.frame_current_cnt = 0;
            this.vx = 0;
        }
    }

    // Use Axis-Aligned Bounding Box for collision detection 
    is_collision(r1, r2) {  // two rectangles have intersection means collision
        if (Math.max(r1.x1, r2.x1) > Math.min(r1.x2, r2.x2))
            return false;
        if (Math.max(r1.y1, r2.y1) > Math.min(r1.y2, r2.y2))
            return false;
        return true;
    }

    // Determine if it has been attacked.
    update_attack() {
        // attack status is 4
        // The fist is swung out in frame 16 of the GIF, and the arm is straightened by frame 20. 
        // So collision is detected in frame 18.
        if (this.status === 4 && this.frame_current_cnt === 18) {
            let me = this, you = this.root.players[1 - this.id];

            // Set up hitbox for arm and fist areas.
            let r1;
            if (this.direction > 0) {  // I face right
                r1 = {
                    x1: me.x + 120,
                    y1: me.y + 40,
                    x2: me.x + 120 + 100,
                    y2: me.y + 40 + 20,
                };
            } else {
                r1 = {  // I face left
                    x1: me.x + me.width - 120 - 100,
                    y1: me.y + 40,
                    x2: me.x + me.width - 120 - 100 + 100,
                    y2: me.y + 40 + 20,
                };
            }
            // Set up the hitbox for the person being hit
            let r2;
            r2 = {
                x1: you.x,
                y1: you.y,
                x2: you.x + you.width,
                y2: you.y + you.height,
            };

            // 
            if (this.is_collision(r1, r2)) {
                you.is_attack();
            }
        }
    }

    // Update the current frame status and render it
    update() {
        this.update_control();
        this.update_move();
        this.update_direction();
        this.update_attack();

        this.render();
    }

    render() {
        let status = this.status;

        if (this.status === 1 && this.direction * this.vx < 0) status = 2;  // The forward and backward GIFs are different

        // Take the object in the animations map corresponding to the current status of the character (which is set by the character class)
        let obj = this.animations.get(status);

        // Render the image in the GIF corresponding to the current frame
        if (obj && obj.loaded) {
            if (this.direction > 0) {
                // k means that the kth image of the GIF corresponding to the current status has been rendered
                // frame_current_cnt is a counter that indicates how many frames the action corresponding to the current status has lasted (cyclic rendering)
                // Switch the next image in the GIF every frame_rate frame
                // A GIF has frame_cnt images
                let k = parseInt(this.frame_current_cnt / obj.frame_rate) % obj.frame_cnt;
                let image = obj.gif.frames[k].image;  // The current frame corresponds to the image that needs to be rendered
                this.ctx.drawImage(image, this.x, this.y + obj.offset_y, image.width * obj.scale, image.height * obj.scale);
            } else {
                this.ctx.save();  // Save the configuration before changing the coordinate system
                this.ctx.scale(-1, 1);  // Flip about the y-axis, all abscissas * -1, ordinates unchanged
                this.ctx.translate(-this.root.game_map.$canvas.width(), 0);  // The canvas is not in the positive coordinate system area after the flip, so translate ctx in the negative direction of the x-axis

                let k = parseInt(this.frame_current_cnt / obj.frame_rate) % obj.frame_cnt;
                let image = obj.gif.frames[k].image;
                this.ctx.drawImage(image, this.root.game_map.$canvas.width() - this.width - this.x, this.y + obj.offset_y, image.width * obj.scale, image.height * obj.scale);

                this.ctx.restore();  // Finally, restore the coordinate system
            }
        }

        // After the animation of the three states of attack, hit, and death is played, they should become idle to avoid cyclic animation. 
        // This is also part of the finite state machine.
        if (status === 4 || status === 5 || status === 6) {
            if (this.frame_current_cnt === obj.frame_rate * (obj.frame_cnt - 1)) {  // If the animation is finished
                if (status === 6) {  // When in a state of death, the last frame should be kept even after the animation is played
                    this.frame_current_cnt--;
                } else {
                    this.status = 0;
                }
            }
        }

        // When the current frame is rendered, modify the counter.
        this.frame_current_cnt++;
    }
}