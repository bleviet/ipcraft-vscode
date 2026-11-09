import {
  channelOf,
  columnsOf,
  routeNets,
  type Box,
  type NetRequest,
  type Point,
  type RoutedWire,
  type Terminal,
} from '../../../../webview/systemDiagram/layout/wireRoutes';

const box = (x: number, y: number, width = 100, height = 60): Box => ({ x, y, width, height });
const east = (x: number, y: number): Terminal => ({ x, y, leaves: 'east' });
const west = (x: number, y: number): Terminal => ({ x, y, leaves: 'west' });

/** Three columns, two boxes in the middle one; terminals on the box edges. */
const obstacles = [box(0, 0), box(200, 0), box(200, 140), box(400, 0)];

const net = (id: string, driver: Terminal, sinks: Terminal[]): NetRequest => ({
  id,
  driver,
  sinks: sinks.map((terminal, i) => ({ id: `${id}.${i}`, terminal })),
});

function insideBox(a: Point, b: Point, target: Box): boolean {
  return (
    Math.min(a.x, b.x) < target.x + target.width &&
    Math.max(a.x, b.x) > target.x &&
    Math.min(a.y, b.y) < target.y + target.height &&
    Math.max(a.y, b.y) > target.y
  );
}

const onWire = (wire: RoutedWire, point: Point) =>
  wire.points.some((candidate, i) => {
    const prev = wire.points[i - 1];
    return prev
      ? Math.min(prev.x, candidate.x) <= point.x &&
          point.x <= Math.max(prev.x, candidate.x) &&
          Math.min(prev.y, candidate.y) <= point.y &&
          point.y <= Math.max(prev.y, candidate.y)
      : candidate.x === point.x && candidate.y === point.y;
  });

describe('columns and channels', () => {
  it('merges overlapping x-intervals into columns with their boxes sorted by y', () => {
    const columns = columnsOf([box(200, 140), box(0, 0), box(50, 90, 100), box(200, 0)]);
    expect(columns.map((column) => [column.left, column.right])).toEqual([
      [0, 150],
      [200, 300],
    ]);
    expect(columns[1].boxes.map((b) => b.y)).toEqual([0, 140]);
  });

  it('finds the channel in the direction the terminal leaves', () => {
    const columns = columnsOf(obstacles);
    expect(channelOf(columns, west(0, 10))).toBe(0);
    expect(channelOf(columns, east(100, 10))).toBe(1);
    expect(channelOf(columns, west(200, 10))).toBe(1);
    expect(channelOf(columns, east(300, 10))).toBe(2);
    expect(channelOf(columns, east(500, 10))).toBe(3);
    expect(channelOf(columnsOf([]), east(10, 10))).toBe(0);
  });
});

describe('routeNets', () => {
  const request = net('clk', east(100, 30), [west(200, 30), west(200, 170), west(400, 30)]);

  it('ties the sinks of several columns into one axis-aligned tree clear of every box', () => {
    const wires = routeNets(obstacles, [request], []);
    expect([...wires.keys()]).toEqual(request.sinks.map((sink) => sink.id));
    for (const sink of request.sinks) {
      const { points } = wires.get(sink.id)!;
      expect(points[points.length - 1]).toEqual({ x: sink.terminal.x, y: sink.terminal.y });
      for (let i = 1; i < points.length; i++) {
        expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
        for (const obstacle of obstacles) {
          expect(insideBox(points[i - 1], points[i], obstacle)).toBe(false);
        }
      }
    }
  });

  it('starts exactly one wire at the driver; the others branch off an earlier wire', () => {
    const wires = [...routeNets(obstacles, [request], []).values()];
    const driver = { x: 100, y: 30 };
    const fromDriver = wires.filter((wire) => !wire.junction);
    expect(fromDriver).toHaveLength(1);
    expect(fromDriver[0].points[0]).toEqual(driver);
    for (const [index, wire] of wires.entries()) {
      if (wire.junction) {
        expect(wires.slice(0, index).some((earlier) => onWire(earlier, wire.points[0]))).toBe(true);
      }
    }
  });

  it('gives two nets in one channel different lanes', () => {
    const other = net('rst', east(100, 100), [west(200, 120)]);
    const wires = routeNets(obstacles, [net('clk', east(100, 30), [west(200, 50)]), other], []);
    const trunkX = (wire: RoutedWire) => wire.points[1].x;
    expect(trunkX(wires.get('clk.0')!)).not.toBe(trunkX(wires.get('rst.0')!));
  });

  it('keeps a lane clear of a vertical data wire in the channel', () => {
    const free = routeNets(obstacles, [net('clk', east(100, 30), [west(200, 50)])], []);
    const laneX = free.get('clk.0')!.points[1].x;
    const data = [
      [
        { x: laneX, y: -50 },
        { x: laneX, y: 300 },
      ],
    ];
    const moved = routeNets(obstacles, [net('clk', east(100, 30), [west(200, 50)])], data);
    expect(Math.abs(moved.get('clk.0')!.points[1].x - laneX)).toBeGreaterThanOrEqual(4);
  });

  it('crosses a column at a height clear of a horizontal data wire', () => {
    const wide = net('clk', east(100, 100), [west(400, 100)]);
    const crossingY = (wires: Map<string, RoutedWire>) =>
      wires
        .get('clk.0')!
        .points.find((point, i, all) => i > 0 && point.y === all[i - 1].y && point.x > 200)!.y;
    const free = crossingY(routeNets(obstacles, [wide], []));
    const data = [
      [
        { x: 180, y: free },
        { x: 320, y: free },
      ],
    ];
    expect(Math.abs(crossingY(routeNets(obstacles, [wide], data)) - free)).toBeGreaterThanOrEqual(
      4
    );
  });

  it('walks west from a driver in a middle channel to sinks on both sides', () => {
    const middle = net('clk', east(300, 100), [west(200, 170), west(0, 30), west(400, 30)]);
    const wires = routeNets(obstacles, [middle], []);
    for (const sink of middle.sinks) {
      const { points } = wires.get(sink.id)!;
      expect(points[points.length - 1]).toEqual({ x: sink.terminal.x, y: sink.terminal.y });
      for (let i = 1; i < points.length; i++) {
        expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
        for (const obstacle of obstacles) {
          expect(insideBox(points[i - 1], points[i], obstacle)).toBe(false);
        }
      }
    }
    expect(wires.get('clk.1')!.points.some((point) => point.x < 0)).toBe(true);
  });

  it('puts the net tapped from the left column left of one tapped from the right at one height', () => {
    const fromRight = net('rst', east(300, 100), [west(200, 30)]);
    const fromLeft = net('clk', east(100, 30), [west(200, 80)]);
    const wires = routeNets(obstacles, [fromRight, fromLeft], []);
    const left = wires.get('clk.0')!.points;
    const right = wires.get('rst.0')!.points;
    // The tap of clk runs from x = 100 to its lane, the tap of rst from its lane to x = 200.
    expect(left[1]).toMatchObject({ y: 30 });
    expect(right[right.length - 2]).toMatchObject({ y: 30 });
    expect(left[1].x).toBeLessThan(right[right.length - 2].x);
  });

  it('gives nets distinct lanes in a channel too narrow for a candidate', () => {
    const narrow = [box(0, 0), box(110, 0)];
    const nets = [0, 1, 2].map((i) =>
      net(`n${i}`, east(100, 10 + i * 12), [west(110, 100 + i * 12)])
    );
    const wires = routeNets(narrow, nets, []);
    const lanes = nets.map((n) => wires.get(`${n.id}.0`)!.points[1].x);
    expect(new Set(lanes).size).toBe(3);
    lanes.forEach((x) => {
      expect(x).toBeGreaterThan(100);
      expect(x).toBeLessThan(110);
    });
  });

  it('crosses a column clear of a terminal height in the channel beside it', () => {
    const crossingY = (wires: Map<string, RoutedWire>) =>
      wires.get('clk.0')!.points.find((point, i, all) => {
        const prev = all[i - 1];
        return (
          prev?.y === point.y && Math.min(prev.x, point.x) < 200 && Math.max(prev.x, point.x) > 300
        );
      })!.y;
    const clk = net('clk', east(100, 30), [west(400, 30)]);
    const alone = crossingY(routeNets(obstacles, [clk], []));
    const neighbour = net('rst', east(300, alone), [west(400, alone)]);
    const crowded = crossingY(routeNets(obstacles, [clk, neighbour], []));
    expect(Math.abs(crowded - alone)).toBeGreaterThanOrEqual(4);
  });

  it('keeps the crossings of neighbouring columns apart in the channel between them', () => {
    const three = [box(0, 0), box(200, 0), box(400, 0)];
    const y = net('y', east(100, 30), [west(400, 30)]);
    const x = net('x', west(0, 30), [west(200, 40)]);
    const wires = routeNets(three, [y, x], []);
    const horizontals = [...wires.values()].flatMap((wire, w) =>
      wire.points.flatMap((point, i, all) =>
        i > 0 && all[i - 1].y === point.y
          ? [
              {
                w,
                y: point.y,
                lo: Math.min(all[i - 1].x, point.x),
                hi: Math.max(all[i - 1].x, point.x),
              },
            ]
          : []
      )
    );
    for (const a of horizontals) {
      for (const b of horizontals) {
        if (a.w < b.w && a.y === b.y) {
          expect(Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it('gives a junction wire the tree path from the driver, and the driver wire none', () => {
    const wires = [...routeNets(obstacles, [request], []).values()];
    for (const wire of wires) {
      if (!wire.junction) {
        expect(wire.lead).toBeUndefined();
        continue;
      }
      const lead = wire.lead!;
      expect(lead[0]).toEqual({ x: 100, y: 30 });
      expect(lead[lead.length - 1]).toEqual(wire.points[0]);
      const path = [...lead, ...wire.points.slice(1)];
      for (let i = 1; i < path.length; i++) {
        expect(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y).toBe(true);
      }
    }
    expect(wires.some((wire) => wire.junction)).toBe(true);
  });

  it('is deterministic', () => {
    const run = () => [...routeNets(obstacles, [request], []).entries()];
    expect(run()).toEqual(run());
  });
});
