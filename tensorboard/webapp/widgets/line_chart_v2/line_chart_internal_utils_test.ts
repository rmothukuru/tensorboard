/* Copyright 2020 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/

import {
  computeDataSeriesExtent,
  getRendererType,
} from './line_chart_internal_utils';
import * as libUtils from './lib/utils';
import {RendererType} from './lib/public_types';

fdescribe('line_chart_v2/line_chart_internal_utils test', () => {
  describe('#computeDataSeriesExtent', () => {
    it('returns min and max from all series', () => {
      computeDataSeriesExtent(
        [
          {
            id: 'foo',
            points: [
              {x: 1, y: -1},
              {x: 2, y: -10},
              {x: 3, y: 100},
            ],
          },
        ],
        {
          foo: {
            id: 'foo',
            displayName: 'foo',
            visible: true,
            color: '#f00',
          },
        }
      );
    });
  });

  describe('#getRendererType', () => {
    it('returns svg when preferred svg', () => {
      expect(getRendererType(RendererType.SVG)).toBe(RendererType.SVG);
    });

    it('returns webgl if webgl2 is supported', () => {
      spyOn(libUtils, 'isWebGl2Supported').and.returnValue(true);
      expect(getRendererType(RendererType.WEBGL)).toBe(RendererType.WEBGL);
    });

    it('returns svg if webgl2 is not supported', () => {
      spyOn(libUtils, 'isWebGl2Supported').and.returnValue(false);
      expect(getRendererType(RendererType.WEBGL)).toBe(RendererType.SVG);
    });
  });
});
