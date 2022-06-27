import {
  OPS, Util, IDENTITY_MATRIX, isNum
} from '../shared/util';
import {
  StateManager,
  TextState
} from "./evaluator";
import {isDict} from "./primitives";

var BoundingBoxesCalculator = (function PartialEvaluatorClosure() {
  function BoundingBoxesCalculator(ignoreCalculations) {
    this.textState = new TextState();
    this.graphicsStateManager = new StateManager(new GraphicsState());
    this.clipping = false;
    this.boundingBoxesStack = new BoundingBoxStack();
    this.boundingBoxes = {};
    this.ignoreCalculations = ignoreCalculations;
  }

  BoundingBoxesCalculator.prototype = {
    // Get Top points of rectangle
    // rectangle corners ABCD (clockwise starting with left bottom corner)
    // rectangle base AB: A(x0, y0), B(x1, y1)
    // rectangle height h
    // return CD
    getTopPoints: function BoundingBoxesCalculator_getTopPoints(x0, y0, x1, y1, h) {
      let l = Math.sqrt(Math.pow(x1 - x0, 2) + Math.pow(y1 - y0, 2)); //base length
      if (l === 0) {
        return [x1 + h, y1 + h, x0 + h, y0 + h];
      }

      let e = [(x1 - x0) / l, (y1 - y0) / l]; //get unit vector for line connecting A and B

      let rotated_e = [-e[1], e[0]]; //rotate unit vector by 90 deg to the left
      let result_vector = [rotated_e[0] * h, rotated_e[1] * h]; //scale unit vactor

      return [x1 + result_vector[0], y1 + result_vector[1], x0 + result_vector[0], y0 + result_vector[1]];
    },

    getTextBoundingBox: function BoundingBoxesCalculator_getTextBoundingBox(glyphs) {
      let tx = 0;
      let ty = 0;
      //Save previous x value to take it into account while calculating width of marked content

      let ctm = this.graphicsStateManager.state.ctm;

      let descent = (this.textState.font.descent || 0) * this.textState.fontSize;
      let ascent = (this.textState.font.ascent || 1) * this.textState.fontSize;
      let rise = this.textState.textRise * this.textState.fontSize;

      //Calculate transformed height and shift to place whole glyph inside of bbox
      let shift = Util.applyTransform([0, descent + rise], this.textState.textMatrix);
      shift[0] -= this.textState.textMatrix[4];
      shift[1] -= this.textState.textMatrix[5];

      let height = Util.applyTransform([0, ascent + rise], this.textState.textMatrix);
      height[0] -= this.textState.textMatrix[4] + shift[0];
      height[1] -= this.textState.textMatrix[5] + shift[1];
      height = Math.sqrt(height[0] * height[0] + height[1] * height[1]);

      //Left Bottom point of text bbox
      //Save before text matrix will be changed with going through glyphs
      let [tx0, ty0] = [this.textState.textMatrix[4] + shift[0], this.textState.textMatrix[5] + shift[1]];

      for (let i = 0; i < glyphs.length; i++) {
        let glyph = glyphs[i];
        if (isNum(glyph)) {
          if (this.textState.font.vertical) {
            ty = -glyph / 1000 * this.textState.fontSize * this.textState.textHScale;
          } else {
            tx = -glyph / 1000 * this.textState.fontSize * this.textState.textHScale;
          }
        } else {
          let glyphWidth = null;
          if (this.textState.font.vertical && glyph.vmetric) {
            glyphWidth = glyph.vmetric[0];
          } else {
            glyphWidth = glyph.width;
          }
          if (!this.textState.font.vertical) {
            let w0 = glyphWidth * (this.textState.fontMatrix ? this.textState.fontMatrix[0] : 1 / 1000);
            tx = (w0 * this.textState.fontSize + this.textState.charSpacing + (glyph.isSpace ? this.textState.wordSpacing : 0)) *
              this.textState.textHScale;
          } else {
            let w1 = glyphWidth * (this.textState.fontMatrix ? this.textState.fontMatrix[0] : 1 / 1000);
            ty = w1 * this.textState.fontSize + this.textState.charSpacing + (glyph.isSpace ? this.textState.wordSpacing : 0);
          }
        }
        this.textState.translateTextMatrix(tx, ty);
      }

      //Right Bottom point is in text matrix after going through glyphs
      let [tx1, ty1] = [this.textState.textMatrix[4] + shift[0], this.textState.textMatrix[5] + shift[1]];
      //Top point can be calculated from base and height
      let [tx2, ty2, tx3, ty3] = this.getTopPoints(tx0, ty0, tx1, ty1, height);
      if (this.textState.textMatrix[3] < 0) {
        ty0 += height * this.textState.textMatrix[3];
        ty1 += height * this.textState.textMatrix[3];
        ty2 += height * this.textState.textMatrix[3];
        ty3 += height * this.textState.textMatrix[3];
      }

      //Apply transform matrix to bbox
      let [x0, y0] = Util.applyTransform([tx0, ty0], ctm);
      let [x1, y1] = Util.applyTransform([tx1, ty1], ctm);
      let [x2, y2] = Util.applyTransform([tx2, ty2], ctm);
      let [x3, y3] = Util.applyTransform([tx3, ty3], ctm);

      let minX = Math.min(x0, x1, x2, x3);
      let maxX = Math.max(x0, x1, x2, x3);

      let minY = Math.min(y0, y1, y2, y3);
      let maxY = Math.max(y0, y1, y2, y3);

      this.boundingBoxesStack.save(minX, minY, maxX - minX, maxY - minY);
    },

    getClippingGraphicsBoundingBox: function BoundingBoxesCalculator_getClippingGraphicsBoundingBox() {
      let state = this.graphicsStateManager.state;

      if (state.clip === null) {
        return {
          x: state.x,
          y: state.y,
          w: state.w,
          h: state.h
        };
      }


      if ((state.x < state.clip.x && state.x + state.w < state.clip.x) ||
        (state.x > state.clip.x + state.clip.w && state.x + state.w > state.clip.x + state.clip.w) ||
        (state.y < state.clip.y && state.y + state.h < state.clip.y) ||
        (state.y > state.clip.y + state.clip.h && state.y + state.h > state.clip.y + state.clip.h)) {
        return null;
      }

      return {
        x: Math.max(state.x, state.clip.x),
        y: Math.max(state.y, state.clip.y),
        w: Math.min(state.x + state.w, state.clip.x + state.clip.w) - Math.max(state.x, state.clip.x),
        h: Math.min(state.y + state.h, state.clip.y + state.clip.h) - Math.max(state.y, state.clip.y)
      };
    },

    saveGraphicsBoundingBox: function saveGraphicsBoundingBox() {
      let clippingBBox = this.getClippingGraphicsBoundingBox();
      if (clippingBBox === null) {
        return;
      }

      let x = clippingBBox.x;
      let y = clippingBBox.y;
      let w = clippingBBox.w;
      let h = clippingBBox.h;

      this.boundingBoxesStack.save(x, y, w, h);
    },

    getRectBoundingBox: function getRectBoundingBox(x, y, w, h) {
      let state = this.graphicsStateManager.state;

      let [x1, y1] = Util.applyTransform([x, y], state.ctm);
      let [x2, y2] = Util.applyTransform([x + w, y], state.ctm);
      let [x3, y3] = Util.applyTransform([x, y + h], state.ctm);
      let [x4, y4] = Util.applyTransform([x + w, y + h], state.ctm);

      x = Math.min(x1, x2, x3, x4);
      y = Math.min(y1, y2, y3, y4);
      w = Math.max(x1, x2, x3, x4) - x;
      h = Math.max(y1, y2, y3, y4) - y;

      if (state.w === null) {
        state.w = Math.abs(w);
      } else {
        state.w = Math.max(state.x + state.w, x, x + w) -
          Math.min(state.x, x, x + w);
      }

      if (state.h === null) {
        state.h = Math.abs(h);
      } else {
        state.h = Math.max(state.y + state.h, y, y + h) -
          Math.min(state.y, y, y + h);
      }

      if (state.x === null) {
        state.x = Math.min(x, x + w);
      } else {
        state.x = Math.min(state.x, x, x + w);
      }

      if (state.y === null) {
        state.y = Math.min(y, y + h);
      } else {
        state.y = Math.min(state.y, y, y + h);
      }
    },

    getLineBoundingBox: function getLineBoundingBox(x, y) {
      let state = this.graphicsStateManager.state;

      [x, y] = Util.applyTransform([x, y], state.ctm);

      if (state.w === null) {
        state.w = Math.abs(x - state.move_x);
      } else {
        state.w = Math.max(x, state.move_x, state.x + state.w) -
          Math.min(x, state.move_x, state.x);
      }

      if (state.h === null) {
        state.h = Math.abs(y - state.move_y);
      } else {
        state.h = Math.max(y, state.move_y, state.y + state.h) -
          Math.min(y, state.move_y, state.y);
      }

      if (state.x === null) {
        state.x = Math.min(x, state.move_x);
      } else {
        state.x = Math.min(x, state.move_x, state.x);
      }

      if (state.y === null) {
        state.y = Math.min(y, state.move_y);
      } else {
        state.y = Math.min(y, state.move_y, state.y);
      }

      //Next line will start from the end of current line
      state.move_x = x;
      state.move_y = y;
    },

    getCurve: function getCurve(a, b, c, d) {
      return function curve(t) {
        return Math.pow(1 - t, 3) * a + 3 * t * Math.pow(1 - t, 2) * b + 3 * t * t * (1 - t) * c + t * t * t * d;
      }
    },

    //Equate the derivative to zero in order to find local extremum and solve the equation
    getCurveRoots: function getCurveRoots(a, b, c, d) {
      let sqrt;
      let root_1;
      let root_2;

      sqrt = Math.pow(6 * a - 12 * b + 6 * c, 2)
        - 4 * (3 * b - 3 * a) * (-3 * a + 9 * b - 9 * c + 3 * d);
      root_1 = null;
      root_2 = null;

      //Calculate roots if equation has roots and they are real
      //Equation has infinite(too big) roots if denominator is too small
      if (Math.abs(a + 3 * c - 3 * b - d) > Math.pow(0.1, -10)) {
        if (sqrt >= 0) {
          root_1 = ((-6 * a + 12 * b - 6 * c) + Math.sqrt(sqrt)) / (2 * (-3 * a + 9 * b - 9 * c + 3 * d));
          root_2 = ((-6 * a + 12 * b - 6 * c) - Math.sqrt(sqrt)) / (2 * (-3 * a + 9 * b - 9 * c + 3 * d));
        }
      } else if (sqrt > Math.pow(0.1, -10)) {
        root_1 = (a - b) / (2 * a - 4 * b + 2 * c);
      }

      //We are only interested in roots that lay in range from 0 to 1
      //Ignore other ones
      if (root_1 !== null && (root_1 < 0 || root_1 > 1)) {
        root_1 = null;
      }
      if (root_2 !== null && (root_2 < 0 || root_2 > 1)) {
        root_2 = null;
      }

      return [root_1, root_2];
    },

    getCurveBoundingBox: function getCurveBoundingBox(op, x0, y0, x1, y1, x2, y2, x3, y3) {
      let state = this.graphicsStateManager.state;

      if (op !== OPS.curveTo2) {
        [x1, y1] = Util.applyTransform([x1, y1], state.ctm);
      }
      [x2, y2] = Util.applyTransform([x2, y2], state.ctm);
      [x3, y3] = Util.applyTransform([x3, y3], state.ctm);

      let curveX = this.getCurve(x0, x1, x2, x3);
      let curveY = this.getCurve(y0, y1, y2, y3);

      let [root_1, root_2] = this.getCurveRoots(x0, x1, x2, x3);

      let minX = Math.min(x0, x3, root_1 !== null ? curveX(root_1) : Number.MAX_VALUE, root_2 !== null ? curveX(root_2) : Number.MAX_VALUE);
      let maxX = Math.max(x0, x3, root_1 !== null ? curveX(root_1) : Number.MIN_VALUE, root_2 !== null ? curveX(root_2) : Number.MIN_VALUE);

      [root_1, root_2] = this.getCurveRoots(y0, y1, y2, y3);

      let minY = Math.min(y0, y3, root_1 !== null ? curveY(root_1) : Number.MAX_VALUE, root_2 !== null ? curveY(root_2) : Number.MAX_VALUE);
      let maxY = Math.max(y0, y3, root_1 !== null ? curveY(root_1) : Number.MIN_VALUE, root_2 !== null ? curveY(root_2) : Number.MIN_VALUE);

      let x = minX;
      let y = minY;
      let h = maxY - minY;
      let w = maxX - minX;

      if (state.w === null) {
        state.w = Math.abs(w);
      } else {
        state.w = Math.max(state.x + state.w, x, x + w) -
          Math.min(state.x, x, x + w);
      }

      if (state.h === null) {
        state.h = Math.abs(h);
      } else {
        state.h = Math.max(state.y + state.h, y, y + h) -
          Math.min(state.y, y, y + h);
      }

      if (state.x === null) {
        state.x = Math.min(x, x + w);
      } else {
        state.x = Math.min(state.x, x, x + w);
      }

      if (state.y === null) {
        state.y = Math.min(y, y + h);
      } else {
        state.y = Math.min(state.y, y, y + h);
      }

      state.move_x = x;
      state.move_y = y;
    },

    getClip: function getClip() {
      if (this.clipping) {
        let state = this.graphicsStateManager.state;
        if (state.clip === null) {
          state.clip = {
            x: state.x,
            y: state.y,
            w: state.w,
            h: state.h
          };
        } else {
          //Intersection with previous clip
          state.clip = {
            x: Math.max(state.x, state.clip.x),
            y: Math.max(state.y, state.clip.y),
            w: Math.min(state.x + state.w, state.clip.x + state.clip.w) - Math.max(state.x, state.clip.x),
            h: Math.min(state.y + state.h, state.clip.y + state.clip.h) - Math.max(state.y, state.clip.y),
          }
        }
        this.clipping = false;
      }
    },

    getImageBoundingBox: function getImageBoundingBox() {
      let state = this.graphicsStateManager.state;
      let [x0, y0] = Util.applyTransform([0, 0], state.ctm);
      let [x1, y1] = Util.applyTransform([0, 1], state.ctm);
      let [x2, y2] = Util.applyTransform([1, 1], state.ctm);
      let [x3, y3] = Util.applyTransform([1, 0], state.ctm);

      state.x = Math.min(x0, x1, x2, x3);
      state.y = Math.min(y0, y1, y2, y3);
      state.w = Math.max(x0, x1, x2, x3) - state.x;
      state.h = Math.max(y0, y1, y2, y3) - state.y;
    },

    parseOperator: function BoundingBoxesCalculator_parseOperator(fn, args) {
      if (this.ignoreCalculations) {
        return;
      }

      switch (fn | 0) {
        case OPS.restore:
          this.graphicsStateManager.restore();
          break;
        case OPS.save:
          this.graphicsStateManager.save();
          break;
        case OPS.fill:
        case OPS.eoFill:
        case OPS.eoFillStroke:
        case OPS.fillStroke:
        case OPS.stroke:
        case OPS.closeEOFillStroke:
        case OPS.closeFillStroke:
        case OPS.closeStroke:
          this.getClip();
          this.saveGraphicsBoundingBox();
          break;
        case OPS.endPath:
          this.getClip();
          this.graphicsStateManager.state.clean();
          break;
        case OPS.transform:
          this.graphicsStateManager.state.ctm = Util.transform(this.graphicsStateManager.state.ctm, args);
          break;
        case OPS.clip:
        case OPS.eoClip:
          this.clipping = true;
          break;
        case OPS.setFont:
          this.textState.fontSize = args[0];
          this.textState.fontMatrix = args[1].font.fontMatrix;
          this.textState.font = args[1].font;
          break;
        case OPS.setTextMatrix:
          this.textState.setTextMatrix(args[0], args[1], args[2], args[3],
            args[4], args[5]);
          this.textState.setTextLineMatrix(args[0], args[1], args[2], args[3],
            args[4], args[5]);
          break;
        case OPS.nextLine:
          this.textState.carriageReturn();
          break;
        case OPS.setCharSpacing:
          this.textState.charSpacing = args[0];
          break;
        case OPS.setWordSpacing:
          this.textState.wordSpacing = args[0];
          break;
        case OPS.setHScale:
          this.textState.textHScale = args[0] / 100;
          break;
        case OPS.setLeading:
          this.textState.leading = args[0];
          break;
        case OPS.setTextRise:
          this.textState.textRise = args[0];
          break;
        case OPS.setLeadingMoveText:
          this.textState.leading = -args[1];
          this.textState.translateTextLineMatrix(...args);
          this.textState.textMatrix = this.textState.textLineMatrix.slice();
          break;
        case OPS.moveText:
          this.textState.translateTextLineMatrix(args[0], args[1]);
          this.textState.textMatrix = this.textState.textLineMatrix.slice();
          break;
        case OPS.beginText:
          this.textState.textMatrix = IDENTITY_MATRIX.slice();
          this.textState.textLineMatrix = IDENTITY_MATRIX.slice();
          break;
        case OPS.moveTo:
          let ctm = this.graphicsStateManager.state.ctm.slice();
          [this.graphicsStateManager.state.move_x, this.graphicsStateManager.state.move_y] = Util.applyTransform(args, ctm);
          break;
        case OPS.lineTo:
          this.getLineBoundingBox(args[0], args[1]);
          break;
        case OPS.curveTo:
          this.getCurveBoundingBox(
            OPS.curveTo,
            this.graphicsStateManager.state.move_x,
            this.graphicsStateManager.state.move_y,
            args[0],
            args[1],
            args[2],
            args[3],
            args[4],
            args[5],
          );
          break;
        case OPS.curveTo2:
          this.getCurveBoundingBox(
            OPS.curveTo2,
            this.graphicsStateManager.state.move_x,
            this.graphicsStateManager.state.move_y,
            this.graphicsStateManager.state.move_x,
            this.graphicsStateManager.state.move_y,
            args[0],
            args[1],
            args[2],
            args[3]
          );
          break;
        case OPS.curveTo3:
          this.getCurveBoundingBox(
            OPS.curveTo3,
            this.graphicsStateManager.state.move_x,
            this.graphicsStateManager.state.move_y,
            args[0],
            args[1],
            args[2],
            args[3],
            args[2],
            args[3]
          );
          break;
        case OPS.rectangle:
          this.getRectBoundingBox(args[0], args[1], args[2], args[3]);
          break;
        case OPS.markPoint:
        case OPS.markPointProps:
        case OPS.beginMarkedContent:
          //Marked content forms the scope
          this.boundingBoxesStack.begin();
          break;
        case OPS.beginMarkedContentProps:
          if (isDict(args[1]) && args[1].has('MCID')) {
            this.boundingBoxesStack.begin(args[1].get('MCID'));

            //Clear graphics bounding box to split graphics in different marked content
            this.graphicsStateManager.state.x = null;
            this.graphicsStateManager.state.y = null;
            this.graphicsStateManager.state.w = null;
            this.graphicsStateManager.state.h = null;

          } else {
            //Marked content with no MCID still forms the scope
            this.boundingBoxesStack.begin();
          }
          break;
        case OPS.endMarkedContent:
          let boundingBox = this.boundingBoxesStack.end();
          if (boundingBox !== null) {
            this.boundingBoxes[boundingBox.mcid] = {
              x: boundingBox.x,
              y: boundingBox.y,
              width: boundingBox.w,
              height: boundingBox.h
            };
          }
          break;
        case OPS.paintXObject:
          if (args[0] === 'Image') {
            this.getImageBoundingBox();
            this.saveGraphicsBoundingBox();
          }
          break;
        case OPS.showText:
          this.getTextBoundingBox(args[0]);
          break;
        default:
          break;
      }
    },

    setFont: function BoundingBoxesCalculator_setFont(translated) {
      this.textState.fontMatrix = translated.font.fontMatrix;
      this.textState.font = translated.font;
    },
  };

  return BoundingBoxesCalculator;
})();

var GraphicsState = (function GraphicsState() {
  function GraphicsState() {
    this.x = null;
    this.y = null;
    this.w = null;
    this.h = null;
    this.move_x = null;
    this.move_y = null;
    this.ctm = IDENTITY_MATRIX.slice();
    this.clip = null;
  }

  GraphicsState.prototype = {
    clone: function GraphicsState_clone() {
      var clone = Object.create(this);
      clone.ctm = this.ctm.slice();
      return clone;
    },
    clean: function GraphicsState_clear() {
      this.x = null;
      this.y = null;
      this.w = null;
      this.h = null;
      this.move_x = 0;
      this.move_y = 0;
      //this.ctm = IDENTITY_MATRIX.slice();
      //clip state stays the same
    }
  };
  return GraphicsState;
})();

var BoundingBoxStack = (function BoundingBoxStack() {
  function BoundingBoxStack() {
    this.stack = [];
  }

  BoundingBoxStack.prototype = {
    begin: function BoundingBoxStack_begin(mcid) {
      this.stack.push({
        x: null,
        y: null,
        w: null,
        h: null,
        mcid: Number.isInteger(mcid) ? mcid : null
      });
    },

    save: function BoundingBoxStack_save(x, y, w, h) {
      let current = this.stack[this.stack.length - 1];

      if (!current) {
        return;
      }

      if (current.w === null) {
        current.w = w;
      } else {
        current.w = Math.max(current.x + current.w, x + w) - Math.min(current.x, x);
      }

      if (current.x === null) {
        current.x = x;
      } else {
        current.x = Math.min(current.x, x);
      }

      if (current.h === null) {
        current.h = h;
      } else {
        current.h = Math.max(current.y + current.h, y + h) - Math.min(current.y, y);
      }

      if (current.y === null) {
        current.y = y;
      } else {
        current.y = Math.min(current.y, y);
      }
    },

    end: function BoundingBoxStack_end() {
      let last = this.stack.pop();

      if (last.mcid !== null) {
        return last;
      } else {
        this.save(last.x, last.y, last.w, last.h);
        return null;
      }
    },

  };

  return BoundingBoxStack;
})();

export {
  BoundingBoxesCalculator,
};
