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
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

import {Chart} from './lib/chart';
import {IChart} from './lib/chart_types';
import {createScale, Scale} from './lib/scale';
import {
  ChartCallbacks,
  ChartOption,
  DataSeries,
  DataSeriesMetadataMap,
  Extent,
  RendererType,
  ScaleType,
} from './lib/public_types';
import {
  areExtentsEqual,
  isOffscreenCanvasSupported,
  isWebGl2Supported,
} from './lib/utils';
import {WorkerChart} from './lib/worker/worker_chart';
import {
  computeDataSeriesExtent,
  getRendererType,
} from './line_chart_internal_utils';
import {TooltipTemplate} from './sub_view/line_chart_interactive_view';

export {TooltipTemplate} from './sub_view/line_chart_interactive_view';

const DEFAULT_EXTENT: Extent = {x: [0, 1], y: [0, 1]};

interface DomDimensions {
  main: {width: number; height: number};
  yAxis: {width: number; height: number};
  xAxis: {width: number; height: number};
}

@Component({
  selector: 'line-chart',
  templateUrl: 'line_chart_component.ng.html',
  styles: [
    `
      :host {
        contain: strict;
        height: 100%;
        width: 100%;
      }

      .container {
        background: #fff;
        display: grid;
        height: 100%;
        overflow: hidden;
        width: 100%;
        grid-template-areas:
          'yaxis series'
          '. xaxis';
        grid-template-columns: 50px 1fr;
        grid-auto-rows: 1fr 30px;
      }

      .series-view {
        grid-area: series;
        position: relative;
        overflow: hidden;
      }

      canvas,
      svg,
      line-chart-grid-view,
      line-chart-interactive-layer {
        height: 100%;
        left: 0;
        position: absolute;
        top: 0;
        width: 100%;
      }

      line-chart-x-axis {
        grid-area: xaxis;
      }

      line-chart-y-axis {
        grid-area: yaxis;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly RendererType = RendererType;

  @ViewChild('main', {static: true, read: ElementRef})
  private main!: ElementRef<HTMLElement>;

  @ViewChild('xAxis', {static: true, read: ElementRef})
  private xAxis!: ElementRef<HTMLElement>;

  @ViewChild('yAxis', {static: true, read: ElementRef})
  private yAxis!: ElementRef<HTMLElement>;

  @ViewChild('chartEl', {static: false, read: ElementRef})
  private chartEl?: ElementRef<HTMLCanvasElement | SVGElement>;

  @Input()
  readonly preferredRendererType: RendererType = isWebGl2Supported()
    ? RendererType.WEBGL
    : RendererType.SVG;

  @Input()
  seriesData!: DataSeries[];

  @Input()
  defaultViewExtent?: Extent;

  @Input()
  seriesMetadataMap!: DataSeriesMetadataMap;

  @Input()
  forceUseWorkerIfCanvas: boolean = false;

  @Input()
  xScaleType: ScaleType = ScaleType.LINEAR;

  @Input()
  yScaleType: ScaleType = ScaleType.LINEAR;

  @Input()
  tooltipTemplate?: TooltipTemplate;

  xScale: Scale = createScale(this.xScaleType);
  yScale: Scale = createScale(this.xScaleType);
  viewExtent: Extent = DEFAULT_EXTENT;

  domDimensions: DomDimensions = {
    main: {width: 0, height: 0},
    xAxis: {width: 0, height: 0},
    yAxis: {width: 0, height: 0},
  };

  private lineChart?: IChart;
  private dataExtent?: Extent;
  private isDataUpdated = false;
  private isMetadataUpdated = false;
  // Must set the default view extent since it is an optional input.
  private isViewExtentUpdated = true;
  private isDefaultViewExtentUpdated = false;
  private maybeSetViewExtentToDefault = true;

  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['xScaleType']) {
      this.xScale = createScale(this.xScaleType);
      if (this.lineChart) {
        this.lineChart.setXScaleType(this.xScaleType);
      }
    }

    if (changes['yScaleType']) {
      this.yScale = createScale(this.yScaleType);
      if (this.lineChart) {
        this.lineChart.setYScaleType(this.yScaleType);
      }
    }

    if (changes['seriesData']) {
      this.isDataUpdated = true;
    }

    if (changes['defaultViewExtent']) {
      this.isDefaultViewExtentUpdated = true;
    }

    if (changes['seriesMetadataMap']) {
      this.isMetadataUpdated = true;
    }

    this.maybeSetViewExtentToDefault = this.shouldResetViewExtent(changes);

    this.updateProp();
  }

  ngAfterViewInit() {
    this.initializeChart();
    this.updateProp();
  }

  onViewResize() {
    if (!this.lineChart) return;

    this.readAndUpdateDomDimensions();
    this.lineChart.resize(this.domDimensions.main);
    this.changeDetector.detectChanges();
  }

  private shouldResetViewExtent(changes: SimpleChanges): boolean {
    if (changes['xScaleType'] || changes['yScaleType']) {
      return true;
    }

    const prevDefaultExtent = this.getDefaultViewExtent();
    const wasViewExtentChanged = !areExtentsEqual(
      prevDefaultExtent,
      this.viewExtent
    );

    // Don't modify view extent if user has manually changed the view box.
    if (wasViewExtentChanged) {
      return false;
    }

    if (changes['seriesData']) {
      return true;
    }

    const seriesMetadataChange = changes['seriesMetadataMap'];
    if (seriesMetadataChange) {
      const prevMetadataMap = seriesMetadataChange.previousValue;
      for (const [id, metadata] of Object.entries(this.seriesMetadataMap)) {
        const prevMetadata = prevMetadataMap && prevMetadataMap[id];
        if (!prevMetadata || metadata.visible !== prevMetadata.visible) {
          return true;
        }
      }
    }

    return false;
  }

  private initializeChart() {
    if (this.lineChart) return;

    const rendererType = this.getRendererType();
    const callbacks: ChartCallbacks = {
      onDrawEnd: () => {},
    };
    let params: ChartOption | null = null;

    this.readAndUpdateDomDimensions();

    switch (rendererType) {
      case RendererType.SVG: {
        params = {
          type: RendererType.SVG,
          container: this.chartEl!.nativeElement as SVGElement,
          callbacks,
          domDimension: this.domDimensions.main,
          xScaleType: this.xScaleType,
          yScaleType: this.yScaleType,
        };
        break;
      }
      case RendererType.WEBGL:
        params = {
          type: RendererType.WEBGL,
          container: this.chartEl!.nativeElement as HTMLCanvasElement,
          devicePixelRatio: window.devicePixelRatio,
          callbacks,
          domDimension: this.domDimensions.main,
          xScaleType: this.xScaleType,
          yScaleType: this.yScaleType,
        };
        break;
    }

    if (!params) {
      return;
    }

    const useWorker =
      rendererType !== RendererType.SVG &&
      (this.forceUseWorkerIfCanvas || isOffscreenCanvasSupported());
    const klass = useWorker ? WorkerChart : Chart;
    this.lineChart = new klass(params);
  }

  ngOnDestroy() {
    if (this.lineChart) this.lineChart.dispose();
  }

  getRendererType(): RendererType {
    return getRendererType(this.preferredRendererType);
  }

  private readAndUpdateDomDimensions(): void {
    this.domDimensions = {
      main: {
        width: this.main.nativeElement.clientWidth,
        height: this.main.nativeElement.clientHeight,
      },
      xAxis: {
        width: this.xAxis.nativeElement.clientWidth,
        height: this.xAxis.nativeElement.clientHeight,
      },
      yAxis: {
        width: this.yAxis.nativeElement.clientWidth,
        height: this.yAxis.nativeElement.clientHeight,
      },
    };
  }

  private updateProp() {
    if (!this.lineChart) return;

    if (this.isMetadataUpdated || this.isDataUpdated) {
      this.isMetadataUpdated = false;
      const metadata: DataSeriesMetadataMap = {};
      // Copy over only what is required.
      this.seriesData.forEach(({id}) => {
        metadata[id] = this.seriesMetadataMap[id];
      });
      this.lineChart.updateMetadata(metadata);
    }

    if (this.isDataUpdated) {
      this.isDataUpdated = false;
      this.lineChart.updateData(this.seriesData);
    }

    let viewExtentChange =
      this.isDefaultViewExtentUpdated ||
      this.isViewExtentUpdated ||
      this.maybeSetViewExtentToDefault;
    if (this.isDefaultViewExtentUpdated && this.defaultViewExtent) {
      this.viewExtent = this.defaultViewExtent;
    } else if (this.maybeSetViewExtentToDefault) {
      this.dataExtent = computeDataSeriesExtent(
        this.seriesData,
        this.seriesMetadataMap
      );
      this.viewExtent = this.getDefaultViewExtent();
    }

    if (viewExtentChange) {
      this.isDefaultViewExtentUpdated = false;
      this.isViewExtentUpdated = false;
      this.maybeSetViewExtentToDefault = false;
      this.lineChart.updateViewBox(this.viewExtent);
    }
  }

  onViewExtentChanged(viewExtent: Extent) {
    this.isViewExtentUpdated = true;
    this.viewExtent = viewExtent;
    this.updateProp();
  }

  onViewExtentReset() {
    this.maybeSetViewExtentToDefault = true;
    this.updateProp();
  }

  private getDefaultViewExtent(): Extent {
    if (this.defaultViewExtent) {
      return this.defaultViewExtent;
    }

    if (!this.dataExtent) {
      return DEFAULT_EXTENT;
    }

    return {
      x: this.xScale.niceDomain(this.dataExtent.x),
      y: this.yScale.niceDomain(this.dataExtent.y),
    };
  }
}
