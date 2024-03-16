+++
title = "A Trustfall Adapter Walkthrough"
date = 2024-01-29
+++

Let me walk you through the `BasicAdapter` for a real project I'm working on: a
Trustfall powered system for querying MIT's course catalog.

# The Schema

The first step to writing an adapter is to describe the shape of our data in a
GraphQL schema. We first define a "root" query type, suggestively named `Query`,
which is the starting node where Trustfall will explore our data from. We can
see here that it has one edge, which points to a list of courses, since that's
the only thing we'd like to query:

```graphql
schema {
    query: Query
}

type Query {
    subjects: [Subject]
}
```

I'm going to go ahead and define a subject now. Edges with a `!` are required.

```graphql
type Subject {
    name: String!,
    instructors: [String!],
    rating: Float,
    schedule: Schedule
}
```

`Schedule` is a custom type, let's define is as a set of `MeetingInfo`s representing
different lecture and recitation sections:

```graphql
type Schedule {
    lecture: [MeetingInfo],
    recitation: [MeetingInfo],
}
```

And now lets finish off with `MeetingInfo`:

```graphql
type MeetingInfo {
    tba: Boolean!,
    location: String
    days: [Day],
    time: MeetingTime,
}

type Day {
    raw_day: String!
}

type MeetingTime {
    start: Time!,
    end: Time
}

type Time {
    hour: Int!,
    minute: Int!
}
```

Our Rust representation of the data lines up beautifully:

```rust
pub struct Subject {
    name: String,
    instructors: String,
    rating: f64,
    schedule: Schedule,
}

pub struct Schedule {
    lecture: Vec<MeetingInfo>,
    recitation: Vec<MeetingInfo>,
}

pub enum MeetingInfo {
    TBA,
    Decided {
        location: String,
        days: Vec<String>,
        time: MeetingTime,
    }
}

pub struct MeetingTime {
    start: Time,
    end: Option<Time>
}

pub struct Time {
    hour: u64,
    minute: u64
}
```

There are a few things to note. Firstly, `MeetingInfo` is an `enum` instead of a `struct`.
In the schema world, if `tba` is true, we won't read any of the other fields.
Secondly, there are no `From` implementations to convert from `usize/isize` to Trustfall's
native integer type, so we use `u64`. Also, assume everything has a derive
`#[derive(Debug, Clone)]`.

# stubgen :)

With our types and schema defined, we can now run `trustfall_stubgen`, which will
write out most of the boilerplate involved with writing an adapter[^2]. All we have do
now is replace some `todo!`s with actual code. In the root directory of the project,
we can run:
```
cargo install --locked trustfall_stubgen
trustfall_stubgen --schema src/schema.graphql --target src/
```
Also make sure to add `trustfall` to your dependences and `pub mod adapter;` to
your `lib.rs`.

et voila! We have an adapter. Let's make it functional.

# Adapter Step 0: Defining our Adapter Type

`stubgen` kindly generates the following boilerplate for us in `src/adapter/adapter_impl.rs`:
```rust
#[non_exhaustive]
#[derive(Debug)]
pub struct Adapter {}

impl Adapter {
    pub const SCHEMA_TEXT: &'static str = include_str!("./schema.graphql");

    pub fn schema() -> &'static Schema {
        SCHEMA.get_or_init(|| Schema::parse(Self::SCHEMA_TEXT).expect("not a valid schema"))
    }

    pub fn new() -> Self {
        Self {}
    }
}
```

Let's make `Adapter` an actually useful type. Really all we need it to do is carry
any data `trustfall` might want to query, so just our list of subjects. All we need
to do is add:
```rust
  pub struct Adapter<'a> {
+     subjects: &'a [Subject]
  }

~ pub fn new(subjects: &'a [Subject]) -> Self {
~      Self { subjects }
  }
```

I've found it useful to carry borrowed data intead of owned data, as we now have
a named lifetime we can use to say the references we hand out last for as long
as we need them to. This'll make a bit more sense later on.
Anyways, we're done defining our adapter, simple as that :)

# Adapter Step 1: Defining our Vertex Data

The next step is just to define our `Vertices`. `stubgen` starts us off
here in `src/adapter/vertex.rs`:

```rust
#[non_exhaustive]
#[derive(Debug, Clone, trustfall::provider::TrustfallEnumVertex)]
pub enum Vertex {
    Day(()),
    MeetingInfo(()),
    MeetingTime(()),
    Schedule(()),
    Subject(()),
    Time(()),
}
```

and all we have to do is fill in the types:

```rust
use crate::{MeetingInfo, MeetingTime, Schedule, Subject, Time};

#[non_exhaustive]
#[derive(Debug, Clone, trustfall::provider::TrustfallEnumVertex)]
pub enum Vertex<'a> {
    Day(&'a str),
    MeetingInfo(&'a MeetingInfo),
    MeetingTime(MeetingTime),
    Schedule(&'a Schedule),
    Subject(&'a Subject),
    Time(Time),
}
```

Since some vertices are expensive to copy (those containing strings), we use
references to those vertices. With that defined, let's figure out what our first
vertex to search will be.

# Adapter Step 2: Resolve Starting Vertices

This is where `BasicAdapter` comes in. Let's first quickly define our `Vertex`
type:
```rust
type Vertex = Vertex<'a>
```

Because our `Adapter` is valid for `'a`, and `Vertex` is valid for `'a`, we can
now use references into `Adapter` to provide `trustfall` vertex data with no
lifetime issues. For example, the first method we need to implement is
in `src/adapter/adapter_impl.rs`.

```rust
fn resolve_starting_vertices(
    &self,
    edge_name: &Arc<str>,
    _parameters: &EdgeParameters, // ignore this
    _resolve_info: &ResolveInfo,  // ignore this
) -> VertexIterator<'a, Self::Vertex> {
    match edge_name.as_ref() {
        "subjects" => super::entrypoints::subjects(resolve_info),
        _ => {
            unreachable!(
                "attempted to resolve starting vertices for unexpected edge name: {edge_name}"
            )
        }
    }
}
```

Basically, Trustfall is asking: what are the first vertices I should search?
The answer is just each subject. Since all of our data is contained in a subject,
to path to finding any piece of data is on a subject vertex.

Thus, we can just return `Box::new(self.subjects.iter().map(Vertex::Subject))`,
and we're done! Having both `Vertex` and `Adapter` be `'a` takes care of all
lifetime issues. Next up: resolving edges.

# Adapter Step 3: Resolving Edges

At this point, all we have to do is replace some `todo!`s with actual code. Our
types are all locked in, and we just need to tell `trustfall` how to "cross" an
edge and get it's data. We do this by implementing the `resolve_neighbors`
trait method:
```rust
    fn resolve_neighbors<V: AsVertex<Self::Vertex> + 'a>(
        &self,
        contexts: ContextIterator<'a, V>,
        type_name: &Arc<str>,
        edge_name: &Arc<str>,
        parameters: &EdgeParameters,
        resolve_info: &ResolveEdgeInfo,
    ) -> ContextOutcomeIterator<'a, V, VertexIterator<'a, Self::Vertex>>;
```

This bad boy look spretty scary, but `stubgen` has actually already filled it
out completely, and redirected the logic to functions defined in `src/adapter/edges.rs`.

You'll notice a bunch of functions that look like:
```rust
pub(super) fn resolve_meeting_info_edge<'a, V: AsVertex<Vertex<'a>> + 'a>(
    contexts: ContextIterator<'a, V>,
    edge_name: &str,
    parameters: &EdgeParameters,
    resolve_info: &ResolveEdgeInfo,
) -> ContextOutcomeIterator<'a, V, VertexIterator<'a, Vertex<'a>>> {
    match edge_name {
        "days" => meeting_info::days(contexts, resolve_info),
        "time" => meeting_info::time(contexts, resolve_info),
        _ => {
            unreachable!("attempted to resolve unexpected edge '{edge_name}' on type 'MeetingInfo'")
        }
    }
}
```

This function represents `trustfall` asking the question. For a series of contexts
(internal views of partially evaluated queries), if I'm at a `MeetingInfo`
vertex, what data do I get if I cross a `days` edge? how about for a `time` edge?
So all we have to do is provide `trustfall` that data. We can do that with a
nifty little function called `resolve_neighbors_with`. `resolve_neighbors_with`
takes two parameters: the list of contexts, and the vertex whose edge we want to
cross. Using `resolve_neighbors_with` looks like this:

```rust
pub(super) fn resolve_meeting_info_edge<'a, V: AsVertex<Vertex<'a>> + 'a>(
    contexts: ContextIterator<'a, V>,
    edge_name: &str,
    parameters: &EdgeParameters,
    resolve_info: &ResolveEdgeInfo,
) -> ContextOutcomeIterator<'a, V, VertexIterator<'a, Vertex<'a>>> {
    match edge_name {
        "days" => resolve_neighbors_with(contexts, move |vertex| {
            // Do stuff wwith the vertex
        }),
        "time" => meeting_info::time(contexts, resolve_info),
        _ => {
            unreachable!("attempted to resolve unexpected edge '{edge_name}' on type 'MeetingInfo'")
        }
    }
}
```

So what _do_ we want to do with this vertex? Let's look at our closure more
carefully:

```rust
move |vertex| {
    // "unwrap" into a MeetingInfo vertex.
    // This should always succeed.
    let vertex = vertex
        // stugben generates an as_* method for each enum variant
        .as_meeting_info()
        .expect("conversion failed, vertex as not a MeetingInfo");

    // Secondly, this meeting only has days on which if
    // it is not TBA
    if let MeetingInfo::Set { days, .. } = vertex {
        // If the time has been set, return an iterator of Day vertices
        Box::new(days.iter().map(String::as_str).map(Vertex::Day))
    } else {
        // Otherwise, we have no days, so return an empty iterator
        Box::new(iter::empty())
    }
}
```

[^1] `rustdoc` outputs JSON that describes the API surface of the crate. The format
is unstable.

[^2] Fun fact: `trustfall_stubgen` is actually implemented using Trusfall, which
runs queries your actual schema so it knows what code to generate.
