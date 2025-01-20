// importing dotenv
require('dotenv').config()
// importing express
const express = require('express')
// importing cores
const cors = require('cors')
// jwt
const jwt = require('jsonwebtoken');
// importing mongodb
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// stripe
const stripe = require("stripe")(`${process.env.PAYMENT_KEY}`);

// application port
const port = process.env.PORT || 5000
// creating express app
const app = express()
// importing cookie parser
const cookieParser = require('cookie-parser');

// <-------------- middlewares ---------------->

// corsOptions for jwt
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  credentials: true,
  optionalSuccessStatus: 200,
}
// using cors middleware
app.use(cors(corsOptions))
// using express.json middleware
app.use(express.json())
// using cookie parser
app.use(cookieParser());

// authenticating verifyToken
const verifyToken = (req, res, next) => {
  const tokenFromClient = req.cookies?.token;
  // no token found from client side check
  if (!tokenFromClient) {
    console.log('no token')
    return res.status(401).send({ message: 'unauthorized access!' })
  };
  // check client token is valid or not
  jwt.verify(tokenFromClient, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      console.log('token error');
      return res.status(401).send({ message: 'unauthorized access!' });
    }
    req.user = decoded;
    // call the next middleware
    next();
  })
}



//<----------------- mongodb --------------->
// mongodb uri 

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eeint.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

// <----------------pure backend-------------------> 

async function run() {
  try {

    // <------------mongodb database and collections ------------->

    // create mongodb database and collection here 
    const database = client.db("buildiqDB");
    const apartmentsCollection = database.collection("apartments");
    const usersCollection = database.collection("users");
    const requestsCollection = database.collection("requests");
    const acceptedRequestsCollection = database.collection("acceptedRequests");
    const paymentsCollection = database.collection("payments");
    const couponsCollection = database.collection("coupons");
    const announcementsCollection = database.collection('announcements');


    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req?.user?.email;
      const filter = { email: email };
      const result = await usersCollection.findOne(filter);

      if (!result || result?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access!' });
      }

      next();
    }









    // <-------------------apis start here---------------------->


    // <--------------jwt related apis----------------->
    // generate jwt
    app.post('/jwt', async (req, res) => {
      // taking user email to create token
      const email = req.body;
      // create token
      const token = jwt.sign(email, process.env.SECRET_KEY, { expiresIn: '5h' });
      // setting the token to local cookie storage
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',

      }).send({ success: true });
    })

    // logout and clear saved token from browser cookie
    app.get('/logout', async (req, res) => {
      res.clearCookie('token', {
        maxAge: 0,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      }).send({ success: true });
    })


    // <------------------Payment related APIS----------------------->
    // payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const { rent, coupon, discount } = req.body;

      // find the coupon in the database
      const filter = { coupon, validity: 'Valid' };
      const result = await couponsCollection.findOne(filter);
      let amount = rent;
      //if coupon is found calculating new pay amount by applying discount
      if (result) amount = parseInt((rent - (rent * result?.discount / 100)) * 100);

      // create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      })
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    // payments api
    app.post('/payments', async (req, res) => {
      const payment = req.body;
      payment.amount = payment.rent - payment.discount;
      const paymentResult = await paymentsCollection.insertOne(payment);

      // todo: carefully delete each item from the cart
      // const query = {
      //   _id:{
      //     $in: payment.cartIds.map(id=> new ObjectId(id))
      //   }
      // }
      // const deleteResult = await cartCollection.deleteMany(query);
      // res.send({paymentResult,deleteResult}); // response final
      // console.log('payment info', payment);


      res.send({ paymentResult }); // remove after completing todo
    })

    // get payment history api
    app.get('/payments/:email', verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.user.email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const result = await paymentsCollection.find(query).toArray();

      res.send(result);
    })



    // <--------------user related apis---------------------->

    // create and assign role to user
    // add verifyToken
    app.post('/users', async (req, res) => {
      const user = req.body;
      const email = user?.email;

      const result = await usersCollection.findOne({ email });
      if (result) {
        res.status(200).send(result);
        return;
      }

      user.role = "user";
      // console.log('user:', user);
      const newResult = await usersCollection.insertOne(user);
      if (newResult.insertedId) {
        res.status(200).send(user);
      }
    })
    // get single user role api
    app.get('/user/:email', async (req, res) => {
      // console.log(req);
      const email = req.params.email;
      // console.log('get single user role:', email)

      const find = { email };

      const result = await usersCollection.findOne(find);
      // console.log('find result:', result);
      res.send(result);
    })

    // get all members (admin access only)
    app.get("/members", verifyToken, async (req, res) => {
      const result = await usersCollection.find({ role: 'member' }).toArray();
      res.send(result);
    })

    //<-----------------------public apis------------------------>

    // get all apartments (open api)
    app.get('/apartments', async (req, res) => {
      const result = await apartmentsCollection.find().toArray();
      res.send(result);
    })

    // get all coupon
    app.get('/coupons', async (req, res) => {
      const result = await couponsCollection.find().sort({ _id: -1 }).toArray();
      res.send(result);
    })
    // get/find one coupon
    app.get('/coupons/:code', async (req, res) => {
      const code = req.params.code;
      const filter = { coupon: code }
      const result = await couponsCollection.findOne(filter);
      res.send(result);
    })

    // <----------------------general user apis------------------------------>

    // request for apartment post api
    app.post('/request-apartment', verifyToken, async (req, res) => {
      if (req.body.email !== req.user.email) {
        res.status(401).send({ message: 'Unauthorized access' });
        return;
      }



      const requestDetails = req.body;
      // check if already a member
      const filter = { email: requestDetails.email, role: 'member' };
      const alreadyMember = await usersCollection.findOne(filter);
      if (alreadyMember) {
        res.status(200).send({ message: 'already user' });
        return;
      }

      // const adminFilter
      const personFilter = { email: req?.user?.email };
      const personDetails = await usersCollection.findOne(personFilter);
      if (!personDetails || personDetails?.role !== 'user') {
        res.status(403).send({ message: 'Forbidden Access' });
        return;
      }

      // check if the user already requested for any apartment and status is pending
      const find = { email: requestDetails.email, status: 'pending' };
      const isAlreadyRequested = await requestsCollection.findOne(find);
      if (isAlreadyRequested) {
        res.status(200).send({ message: 'already requested' });
        return;
      }

      const result = await requestsCollection.insertOne(requestDetails);
      res.send(result);
    })

    // <--------------------------member apis--------------------->

    // get my accepted request(my apartment) api
    app.get('/my-apartment/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const find = { email };
      const result = await acceptedRequestsCollection.findOne(find);

      res.send(result);
    })

    // get payment history for specific email (sends most recent payments history)
    app.get('/payments-history/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const filter = { email };
      const result = await paymentsCollection.find(filter).sort({ _id: -1 }).toArray();
      res.send(result);
    })

    // <---------------------------admin apis-------------------------->

    // get all request api(only pending)
    app.get('/requests', verifyToken, verifyAdmin, async (req, res) => {
      const query = { status: 'pending' };
      const result = await requestsCollection.find(query).toArray();
      res.send(result);
    })


    // update apartment request status
    app.patch('/update-request', verifyToken, verifyAdmin, async (req, res) => {
      const requestDetails = req.body;
      const query = { _id: new ObjectId(requestDetails.id) };
      const updatedRequest = {
        $set: {
          status: requestDetails.status
        }
      }
      const result = await requestsCollection.updateOne(query, updatedRequest);
      res.send(result);
    })

    // if the request is accepted save the data to the acceptedRequestsCollection
    app.post('/accepted-requests', verifyToken, verifyAdmin, async (req, res) => {
      const request = req.body;
      const result = await acceptedRequestsCollection.insertOne(request);
      res.send(result);
    })

    // updated role user/member based on apartment request status
    app.patch('/update-role', verifyToken, verifyAdmin, async (req, res) => {
      const userDetails = req.body;
      const query = { email: userDetails?.email };
      const updatedUser = {
        $set: {
          role: userDetails?.role
        }
      }
      const result = await usersCollection.updateOne(query, updatedUser);
      // if delete apartment is true then remove apartment from accepted requests collection
      if (userDetails?.deleteApartment) {
        const deleteApartmentAllocation = await acceptedRequestsCollection.deleteOne(query);
      }

      res.send(result);
    })

    // add new coupon
    app.post('/coupons', verifyToken, verifyAdmin, async (req, res) => {
      const couponDetails = req.body;
      const result = await couponsCollection.insertOne(couponDetails);
      res.send(result);
    })



    // change coupon validity status
    app.patch('/coupons', verifyToken, verifyAdmin, async (req, res) => {
      const { validity, id } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedCoupon = {
        $set: {
          validity: validity
        }
      }
      const result = await couponsCollection.updateOne(filter, updatedCoupon);
      res.send(result);
    })

    // delete coupon
    app.delete('/coupons/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await couponsCollection.deleteOne(filter);
      res.send(result);
    })

    // post announcement
    app.post('/announcements', verifyToken, verifyAdmin, async (req, res) => {
      const announcement = req.body;
      const result = await announcementsCollection.insertOne(announcement);
      res.send(result);
    })
    // get all recent announcements
    app.get('/announcements', verifyToken, async (req, res) => {
      const result = await announcementsCollection.find().sort({ _id: -1 }).toArray();
      res.send(result);
    })
    // delete specific announcement
    app.delete('/announcements/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await announcementsCollection.deleteOne(filter);
      res.send(result);
    })



    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 })
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!'
    // )
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)
app.get('/', (req, res) => {
  res.send('Hello from Project Server....')
})
app.listen(port, () => console.log(`Server running on port ${port}`))
