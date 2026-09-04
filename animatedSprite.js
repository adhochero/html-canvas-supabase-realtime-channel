export class AnimatedSprite{
    constructor(spriteSheet, totalColumns, totalRows, currentRow, framesOnRow, scale, x, y, secPerFrame, playAllRows = true, loop = true, autoStart = false){
        this.spriteSheet = spriteSheet;
        this.totalColumns = totalColumns;
        this.totalRows = totalRows;
        this.currentRow = currentRow;
        this.framesOnRow = framesOnRow;
        this.scale = scale;
        this.x = x;
        this.y = y;
        this.secPerFrame = secPerFrame;
        this.playAllRows = playAllRows;
        this.loop = loop;
        this.isPlaying = autoStart;
        this.finished = false;
        
        this.currentFrame = 0;
        this.frameTimer = 0;
    }

    start() {
        this.isPlaying = true;
        this.finished = false;
        this.currentFrame = 0;
        if (this.playAllRows) this.currentRow = 1;
    }
    
    stop() {
        this.isPlaying = false;
    }
    
    reset() {
        this.currentFrame = 0;
        this.frameTimer = 0;
        if (this.playAllRows) this.currentRow = 1;
        this.finished = false;
    }

    update(deltaTime) {
        if (!this.isPlaying || this.finished) return;
    
        this.frameTimer += deltaTime;
        if (this.frameTimer <= this.secPerFrame) return;
    
        this.frameTimer = 0;
    
        if (this.playAllRows) {
            this.currentFrame++;
            if (this.currentFrame > this.totalColumns - 1) {
                this.currentFrame = 0;
                this.currentRow++;
            }
    
            if (this.currentRow === this.totalRows && this.currentFrame === this.framesOnRow - 1) {
                if (this.loop) {
                    this.currentRow = 1;
                    this.currentFrame = 0;
                } else {
                    this.finished = true;
                    this.isPlaying = false;
                }
            }
        } else {
            if (this.currentFrame < this.framesOnRow - 1) {
                this.currentFrame++;
            } else {
                if (this.loop) {
                    this.currentFrame = 0;
                } else {
                    this.finished = true;
                    this.isPlaying = false;
                }
            }
        }
    }
    

    drawSprite(context){
        // A finished non-looping animation keeps drawing, holding on its last frame.

        //get frames size based on spritesheet (Image has naturalWidth, canvas has width)
        let sheetWidth = this.spriteSheet.naturalWidth || this.spriteSheet.width;
        let sheetHeigth = this.spriteSheet.naturalHeight || this.spriteSheet.height;
        let frameWidth = sheetWidth / this.totalColumns;
        let frameHeight = sheetHeigth / this.totalRows;
    
        context.imageSmoothingEnabled = false;
        context.drawImage(
            this.spriteSheet, //img
            this.currentFrame * frameWidth, //sx
            (this.currentRow - 1) * frameHeight, //sy
            frameWidth, //swidth
            frameHeight, //sheight
            this.x - frameWidth * 0.5 * this.scale, //x
            this.y - frameHeight * 0.5 * this.scale, //y
            frameWidth * this.scale, //width
            frameHeight * this.scale //height
        );
    }

    setSpriteSheet(spriteSheet, totalColumns, totalRows, currentRow, framesOnRow, secPerFrame) {
        this.spriteSheet = spriteSheet;
        this.totalColumns = totalColumns;
        this.totalRows = totalRows;
        this.currentRow = currentRow;
        this.framesOnRow = framesOnRow;
        this.secPerFrame = secPerFrame;
    
        this.currentFrame = 0;
        this.frameTimer = 0;
    }
}